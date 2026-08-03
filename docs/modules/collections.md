# Collections

Collections is the field side of the money flow: a collector works an assigned worklist, knocks on doors, and **logs** what happened — but never posts a payment. A `collection_entries` row is NOT a payment until the owner or admin posts it back at the office (`post_collection_entry` → `record_payment`), which is what keeps a single, receipt-numbered payment ledger while still capturing every visit, including the ones that collected nothing. Accountability is deliberately built on a **daily report plus a remittance ledger** (`v_collector_day`, `v_collector_remittance`), not per-visit GPS surveillance. The module is migration 0012 (entries, advances, views, RPCs) plus 0021 (promise dates and field receipt numbers) and 0030 (remittances and entry↔payment linking), with the customer-facing pieces from 0020 (the two Messenger links) and 0023 (structured addresses and collector GPS tagging). Routes: `/collections` (role-split board), `/collections/report`, `/collections/remittances`, `/collections/sop`. Table and view shapes are cataloged in [../database.md](../database.md); this page covers how the flow actually works.

## The worklist

There is no `v_collector_worklist` object. The collector board (`src/app/(app)/collections/page.tsx`) reads `v_contract_collections` — financials plus `collector_id` / `agent_id` / `collection_priority` — filtered to `payment_status = 'open'` and ordered by `collection_priority` (ascending, nulls last) then `overdue_amount` (descending). Because the view is `security_invoker` and `contracts` RLS scopes a collector to their own assignments, "open" already means "assigned to me" with no extra predicate.

Two layers of ordering are then applied in the page:

1. **Due promises jump the queue.** The board joins `v_open_promises` (one row per contract: the most recent still-pending promise whose date has arrived) and floats those accounts into a highlighted "Promised today or overdue" group at the very top — the customer said they would pay, so that visit is the one most likely to collect. A promise past its date is labeled "overdue promise".
2. **Everything else groups by area** — `municipality · barangay` (falling back to "No address on file"), biggest clusters first — so a day's route is one municipality at a time rather than criss-cross across the province. This grouping is why `set_customer_address` validates against `ph_locations`: a typo'd barangay would silently split an area into two groups.

Each worklist card carries the account (name, contract, last payment, priority, street/purok and landmark, followup tier, past-due amount) and the field actions: the log dialog, a copy-to-clipboard follow-up message (`buildFollowupMessage`, see [../business-rules-legal.md](../business-rules-legal.md) for tone rules), the collection group chat link, a Directions link, and the GPS tag button.

Owner/admin see a different board on the same route: the to-post queue, today's per-collector activity (`v_collector_day`), cash-advance management, and an "Assign collectors" list of overdue/demand accounts (top 60 by overdue amount) driven by `assign_collector` — which insists the assignee is an active `collector` and also sets the optional priority rank.

## Log → post: the pipeline

`log_collection` is the collector's **only** write into the money flow. Its guards (all in SQL — the dialog merely mirrors them):

- Caller must be a collector, and the contract must be assigned to them.
- `disposition` is one of `collected` / `promised` / `not_available` / `refused`.
- A `collected` entry needs an amount > 0 and a method (`cash` or `online`); **online needs the payer's reference number; cash needs the collector's booklet receipt number (`or_no`)** — no receipt, no money, because the app cannot print an official receipt until posting.
- A `promised` entry needs a `promised_date`, and not in the past — a promise with no date cannot be followed up.

The entry lands as `pending` with a `CE####` number and `work_date = ph_today()`. From there:

- **Post** (owner/admin, `post_collection_entry`): only a pending `collected` entry with an amount. It calls `record_payment` with the entry's work date, amount, and reference, plus the receipt number and type the admin supplies at posting, then marks the entry `posted` and links `payment_id`. From this point the money follows the payment rules in [contracts-payments.md](contracts-payments.md) (void/restore, never delete).
- **Cancel** (`cancel_collection_entry`): pending entries only; owner/admin may cancel any, a collector only their own. The reason is appended to the note as `[cancelled: …]`.

`v_collector_day` excludes cancelled entries from every count and total, so a cancelled mis-log never inflates a remittance figure.

## The three receipt numbers

Three different numbers orbit one payment, and conflating them is exactly the confusion 0021 fixed:

| Field | Whose number | When |
|---|---|---|
| `collection_entries.or_no` | The **collector's** pre-numbered field receipt booklet | Written at the door, required for cash |
| `collection_entries.reference_no` | The **payer's** GCash/online confirmation | Captured at the door, required for online |
| `payments.receipt_no` | The **office's** official receipt | Assigned later, by the admin at posting |

## Promises

`promised_date` is what gives the worklist a memory. `v_open_promises` picks, per contract, the most recent pending `promised` entry whose date is today or earlier (Manila), and the collector board floats those accounts to the top. The SOP's partial-payment script exists for the same reason: accept what is offered, thank them, then get a date for the rest — and log it, so the follow-up visit schedules itself. A promise clears from the view when the resulting entry is posted or cancelled.

## Daily report

`/collections/report` renders `v_collector_day` for a chosen date (`?date=`, default today): per collector, counts by disposition and the cash / online / posted / pending-to-post totals, plus the detailed entry list. RLS scopes a collector to their own rows; owner/admin see everyone. The reconcile ritual is simple: the collector's physical cash plus booklet receipts must match `cash_total`, and the SOP's hard rule is **remit everything by 4:30 PM the same day** — cash never goes home.

This page answers "what happened on this date". The running balance of what each collector still owes lives on the Remittances page below.

## Remittances (0030)

`remittances` (`RMT####`) is one row per hand-over of field cash to the office. Before 0030 nothing recorded this at all — the reconcile was a paper ritual and the app's only stand-in was `pending_total`, which answers a different question entirely and drops to zero the moment the admin posts, whether or not a peso changed hands.

The cadence is deliberately flexible (one hand-over may settle several days), so the model is a running balance, exposed by `v_collector_remittance`:

```
cash_on_hand = cash collected − remitted
```

Three properties of that formula are deliberate and must survive refactors:

- **Entry status is irrelevant.** Both `pending` and `posted` entries count. Posting is a bookkeeping act at the office desk; the cash is in the collector's bag until they hand it over. This is what keeps the balance right under the house workflow, where entries routinely stay pending (see "Two posting paths" below).
- **Online contributes zero**, by the `method = 'cash'` filter. A GCash payment goes straight to the owner's number and never passes through the collector's hands: real collection performance, nothing to remit. `log_collection` forces `method` non-null on collected entries, so the filter cannot silently drop a row.
- **A voided payment does not refund custody.** The collector still took the cash; voiding is a ledger correction. If the void is because the cash never existed, cancel the *entry* — that is what removes it from the balance.

Writes: `record_remittance` (owner/admin — whoever physically receives the cash), `cancel_remittance` (**owner only**, mirroring `void_payment`: un-declaring cash the office acknowledged receiving is the more dangerous direction). Rows are never deleted; a wrong amount is cancelled and re-recorded. Neither RPC caps the amount against the computed balance — entries get logged late, and a hard cap would block a legitimate hand-over at the counter — so the UI shows the live balance beside the form as a soft guard instead.

**No opening balances were seeded.** An automatic "settled on paper" row would record a hand-over the app never witnessed, so every collector started showing their full collection history as cash on hand and the owner recorded the real hand-over once.

`/collections/remittances` carries the per-collector balances, the ledger, and a `?month=` history table (`v_collector_month`). It is reached from the page headers, not the nav, for the same reason as `/collections/sop`. `v_collector_month` is deliberately entries-only, with no remitted column: under a flexible cadence a remittance does not belong to the month of the entries it settles, so bucketing them together would manufacture a shortfall in one month and a surplus in the next.

`v_collector_remittance` ends with `and (can_post_payments() or p.id = auth.uid())`. That predicate is load-bearing: `profiles_select` is a bare `is_active_user()`, so without it a collector would get a row per colleague, and because their RLS hides the *amounts* those rows would read as genuine zeroes.

### Two posting paths, and the link action

`post_collection_entry` calls `record_payment` — exactly what the Contracts tab does. **They are the same act, and doing both creates two payments for one collection.** The house workflow is the Contracts tab, so the collector's entry is normally left behind as a ghost in the to-post queue while the payment exists independently: the money is banked correctly and the customer's balance is right, but nothing joins the two.

`v_entry_payment_candidates` finds those pairs (same contract, exact amount, within seven days, payment not voided and not already linked) and the board offers **`link_collection_payment`**, which closes the entry against the payment that already exists and creates nothing. One payment can back only one entry. Posting is still possible on a matched entry — a genuine second payment of the same size can happen — but the dialog warns in red and relabels the button "Post a second payment", because it is not reversible without a void.

### Known gap: direct GCash

A GCash payment that arrives with no collection entry has no collector fingerprint except contract assignment, so collector performance counts only entries the collector logged. Crediting by assignment instead would hand the collector credit for office walk-ins and the owner's own Messenger follow-ups. The real case is already covered: a collector who prompts a GCash payment during a visit logs it as an `online` entry and is credited. Changing this later is a view change, not a schema change.

## Cash advances

Gasoline and collection expenses are floated as `cash_advances` (`CA####`) with two entry paths: the collector requests (`request_cash_advance` → `requested`, owner/admin `approve_cash_advance` or `decline_cash_advance` with a reason) or the owner/admin issues directly (`issue_cash_advance` → `open` immediately). Against an open advance, the collector (own) or owner/admin logs receipts with `add_advance_expense`; the UI shows spent vs outstanding. When receipts plus returned cash reconcile, owner/admin `close_cash_advance`. Expenses cascade-delete with their advance; everything else is append-and-status, so the trail survives.

## GPS tagging and directions

`tag_customer_gps` and `set_customer_landmark` are deliberately open to the **collector** as well as owner/admin — the only person ever standing at the customer's door — but a collector may only touch a customer they have an assigned contract for (the same guard shape as `log_collection`). Coordinates are client-supplied and therefore spoofable: this is a convenience and an audit trail (`gps_tagged_by` / `gps_tagged_at`), not proof of presence.

The tag button (`tag-gps-button.tsx`) reads the browser's geolocation with high accuracy, distinguishes every failure mode (denied, timeout, unsupported, unavailable) because a silent no-op would look like success, and **refuses a fix worse than ±200 m** — a bad pin would send the next collector to the wrong end of the barangay. SQL additionally clamps stored accuracy to 0–1000 m and range-checks lat/lng.

The Directions link (`directionsUrl` in `src/lib/maps.ts`) prefers, in order: the tagged pin (exact), the legacy `gps_url` from the Sheet (opaque but usually a real pin), then a Google Maps text search of the formatted address (rough — the UI marks it with `~`). It is a plain Maps URL on purpose: opens the app the collector already has, needs no API key, adds no third-party request.

## The two Messenger links

A customer has two distinct Messenger URLs (0020), and the importer used to collapse them into one column, silently discarding one:

- `messenger_url` — the customer's **personal** FB/Messenger profile, captured at sale time. Shown on the contract and customer pages, **not** on the collector worklist.
- `collection_gc_url` — the **collection group chat** (owner + admin + collector + customer) the admin creates after the sale. This is the only link the worklist card renders.

Collectors get the group chat only: collection talk belongs where the owner and admin can see it, and steering field communication into a chat the customer joined knowingly keeps it inside the Data Privacy Act's lines (see [../business-rules-legal.md](../business-rules-legal.md) — never disclose a debt to a third party). `set_customer_links` (owner/admin only — `customers` previously had no update path at all) writes both; a collector must not be able to repoint the chat they are chased on. Pass `null` to leave a link unchanged, `''` to clear it.

## The field SOP

`/collections/sop` is the field manual as an app page — reachable by collectors and owner/admin, linked from the Worklist header ("How to collect") rather than the nav, because the collector's mobile tab bar is already nearly full. It pairs every situation (opening the visit, payment, partial payment, promise, nobody home, refusal) with a Cebuano script and English gloss, tells the collector exactly what to log for each outcome, and opens with the non-negotiables: no receipt no money, same-day remittance by 4:30 PM, never discuss the account with anyone but the customer, visits 6 AM–10 PM only, never threaten, never shame. Those rules are the operational face of the legal constraints in [../business-rules-legal.md](../business-rules-legal.md).
