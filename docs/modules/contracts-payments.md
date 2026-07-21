# Contracts & Payments

This is the core module: everything else (collections, commissions, deliveries, analytics) hangs off a `contracts` row and its `payments`. The design center is **snapshot at creation, derive everything else**. A contract's money columns are computed once by `create_contract` and physically locked by a trigger; every number that depends on "today" is derived in `v_contract_financials`; and the only sanctioned way the price ever moves again is the two-step repricing flow. Table and view definitions are cataloged in [database.md](../database.md) — this page covers the lifecycle and flow.

## Creating a contract, end to end

The new-sale form (`src/app/(app)/contracts/new/`) shows a live terms preview computed by the TS `computeTerms()` — preview only; the SQL `compute_terms()` recomputes and snapshots the real values. The server action `createContract` (`contracts/actions.ts`) then does, in order:

1. **Customer**: an existing customer is picked by typeahead, or a new one is inserted directly (customers is one of the few tables active users may write via RLS). For a new customer the structured address (validated province/municipality/barangay, see [database.md](../database.md)) is written AND composed into the legacy free-text `address`, so print pages and CSV exports keep working unchanged.
2. **`create_contract` RPC** (owner/admin only via `can_post_payments()` — a collector or agent physically cannot create a sale). Inside one transaction it: takes the next `contract:YYYY` counter and mints `contract_no` = `YYYY###`; runs `compute_terms(cash_price, term_months)` and snapshots `total_price` / `downpayment` / `monthly_amortization`; defaults a blank sales agent to `'Office Sales'`; writes the optional opening note into `contract_notes`; and, if a registered `agent_id` was attached, creates the `commissions` row (10% of `cash_price`, snapshotted — see [commissions-leads.md](commissions-leads.md)).
3. **Delivery is enqueued by trigger, not by the action**: the after-insert trigger `contracts_enqueue_delivery` creates the one-per-contract `deliveries` row as `pending` (see [deliveries-inventory-products.md](deliveries-inventory-products.md)).
4. If the sale came from a lead (`/contracts/new?leadId=`), the action marks the lead converted, then redirects to the contract page.

After that, `guard_contract_money` (a `before update` trigger from 0022) rejects any change to `cash_price`, `total_price`, `downpayment`, `monthly_amortization`, or `term_months` — including by the owner through PostgREST — unless the transaction-local setting `app.allow_terms_change` is on, which only `confirm_reprice` / `revert_reprice` set. The owner's edit page (`updateContract`) can change descriptive fields and `payment_status` via the owner's RLS UPDATE, but not the money.

## Terms math

The formulas and the two-places rule (TS `computeTerms` + SQL `compute_terms`, both asserted against `GOLDEN_CASES`) are covered in [architecture.md](../architecture.md#business-math-exactly-two-synced-places). The operational rule here: **a contract stores results, not formulas.** Changing a formula affects only future contracts; history never recomputes. `GOLDEN_CASES` in `src/lib/amortization.ts` is the shared fixture — change the math in both places, then run `npm test` and `npx tsx scripts/verify-sql-terms.ts`.

## Cash sales

A cash/outright sale (0016) is not a separate model — it is a contract with `sale_type='cash'`, `term_months=0`, `downpayment = total_price = cash_price`, `monthly_amortization = 0`. `create_contract` builds that shape itself when `p_sale_type='cash'` (it never calls `compute_terms`, which would reject term 0). The payoff: `v_contract_financials` computes `expected_to_date = downpayment + monthly × min(elapsed, 0)` = the full price due immediately, so overdue/balance/tier, `v_contract_dp`, analytics, and the delivery trigger are all correct with **no view changes**. In the UI, `isCash` is simply `term_months === 0`. A cash sale cannot be repriced (`propose_reprice` rejects it).

## Payments: record, void, restore

`record_payment` (owner/admin) is the only way a payment exists. It mints `payment_no` = `PAY####` from the race-safe counter and stamps `recorded_by`. The form fields map to three distinct numbers that are easy to conflate:

| Field | What it is |
|---|---|
| `payment_no` | Internal `PAY####`, generated — never typed |
| `receipt_no` | The physical OR booklet number, hand-typed, required; `receipt_type` says which booklet (Appliances / Furniture) |
| `reference_no` | Optional payer-side reference (e.g. the GCash ref) |

(A fourth lookalike, `collection_entries.or_no` — the collector's *field* receipt booklet — belongs to [collections.md](collections.md); it is not any of these.)

**Payments are never deleted.** `void_payment(p_payment_id, p_reason)` stamps `voided_at`/`voided_by`/`void_reason`; `unvoid_payment` clears them. Both are **owner-only** — stricter than recording, which admin can also do. Every financial view filters `voided_at is null`, so voiding a payment instantly moves every derived number (balance, tier, commission earning, analytics) without touching any row but the payment's own. The `/print/receipt/[paymentId]` page renders the acknowledgment for a recorded payment.

## Time-dependent numbers and the follow-up tiers

Everything that depends on "today" — `months_elapsed`, `expected_to_date` (= downpayment + monthly × min(elapsed, term)), `overdue_amount`, `remaining_balance`, `months_since_last_payment` (fractional, days ÷ 30.44), `followup_tier` — comes only from `v_contract_financials`, computed against `ph_today()` (Asia/Manila). Never recompute these in JS.

`followup_tier` resolves in order: `closed` (payment_status) → `on_track` (balance ≤ 0, or expected-to-date covered within a ₱0.009 tolerance) → `demand` (last payment ≥ 3 fractional months ago) → `overdue`. Because `demand` keys on the *last payment date*, **an account that has never paid can never reach `demand`** — review those by hand.

The tier drives `src/lib/messages.ts`: `buildFollowupMessage` renders the check-in / friendly-overdue / formal-demand Messenger text, and `buildDemandLetterBody` the printed letter (`/print/demand-letter/[id]`), which quotes the contract clause and gives `DEMAND_DEADLINE_DAYS` (15) to settle. The letter states the two Recto Law remedies as **alternatives** and commits to electing one — the legal reasoning is in [business-rules-legal.md](../business-rules-legal.md). Serving the letter is also what legally puts the customer in default (Art. 1169); printing it does **not** advance the repossession stage (below) — those are separate decisions.

## Term repricing (Good-as-Cash lapse)

A 4/5-month Good-as-Cash contract whose term has elapsed with a balance outstanding has had a long loan at a no-markup price. Repricing moves it to the 6-month schedule (and 6 → 12), **two-step and never automatic**:

1. **`propose_reprice(contract, new_term)`** (owner/admin) drafts a `contract_repricings` amendment (`AMD####`) — the contract itself is untouched. SQL enforces every condition: installment only, still open, escalation only along 4/5→6→12, the current term actually elapsed (`months_elapsed_ph`), and a balance actually outstanding. One pending proposal per contract (partial unique index).
2. The customer signs the printed amendment (`/print/amendment/[id]`).
3. **`confirm_reprice(repricing, signed_date)`** flips `term_months`/`total_price`/`monthly_amortization` through the guard trigger's controlled gate, marks the amendment `signed`, and writes a human-readable `contract_notes` entry beside the automatic `audit_log` rows.

**`cash_price` and `downpayment` never change.** Downpayment is 25% of cash price and therefore term-invariant; commissions are 10% of the `cash_price` snapshot and `v_contract_dp.dp_paid` measures against `downpayment` — moving either would silently un-earn commissions. `revert_reprice` restores the *first* signed amendment's original figures if the customer settles (the customer-favoring direction is deliberate — see [business-rules-legal.md](../business-rules-legal.md) on Art. 1308, and 0022's header comment for the full legal shape).

Two consequences to keep in mind: the printed contract reads `v_contract_original_terms`, not the live row, so a reprice never puts new figures above an old signature; and the analytics sales views sum `total_price` by `contract_date`, so a reprice restates a past month's reported sales (reconstructible from `contract_repricings` — known, undecided).

## Repossession

`repossession_stage` (0027) is the owner's escalation pipeline after collection fails: `none` → `letter_prepared` → `letter_sent` → `for_pullout` → `repossessed`, set only via `set_repossession_stage` (owner-only), surfaced on the contract page's repossession control. It advances only by explicit owner decision — deliberately not auto-advanced by printing or sending the demand letter, because under the Recto Law taking the item back **cancels the sale and bars recovering the balance**; electing that remedy is a real decision, not a workflow side effect. See [business-rules-legal.md](../business-rules-legal.md), including the unresolved question about payments kept on past repossessions.

## The three status signals

After 0027 a contract carries exactly four status signals, and only two are manual:

| Signal | Set by | Meaning |
|---|---|---|
| `followup_tier` | **Auto** (view) | Money + dates: closed / on_track / overdue / demand |
| `collection_situation` | **Auto** (view) | Human-readable situation derived from the tier, the repossession stage (which dominates when set), and the latest non-cancelled collection entry — e.g. "Promised to pay Jul 26", "Not reached (last tried Jul 18)", "Overdue — no visit logged" |
| `payment_status` | Manual, owner | `open` / `closed` — the owner closes a finished contract (`close_contract`, or the edit page) |
| `repossession_stage` | Manual, owner | The pipeline above |

The old hand-typed `collection_status` text column, its `StatusForm`, the `update_contract_status` RPC, and the `COLLECTION_STATUSES` constant were **deleted** in 0027 — the column was blank on 95% of rows, nothing read it as logic, and collectors couldn't see it. Do not reintroduce a hand-typed status; if a new situation needs surfacing, extend the `collection_situation` derivation. (`delivery_status` still exists on contracts but is a trigger-synced legacy label owned by [deliveries-inventory-products.md](deliveries-inventory-products.md), never hand-edited.)
