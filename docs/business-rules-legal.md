# Business rules and Philippine law

The installment business runs inside a set of legal constraints that were verified against the actual statutes, not assumed. Several of them shaped real code paths, so "simplifying" the code usually means breaking the law or the business. This page records each rule, what it requires, and where it lives in the app.

## Recto Law — Civil Code Article 1484 (installment sales of personal property)

When goods are sold on installment, the seller has a fixed menu of remedies if the buyer defaults. Because the E & J contract creates **no chattel mortgage** (clause 2 is bare retention of title), only two remedies exist:

1. **Sue for the unpaid balance**, or
2. **Cancel the sale and take the item back.**

They are strict alternatives. Taking the item back **bars** recovering the balance, and any contract clause saying otherwise is void. Consequences in the app:

- The demand letter (`/print/demand-letter/[id]`) states a **single elected remedy**, never both.
- `repossession_stage` (owner-only, `set_repossession_stage`: none → letter_prepared → letter_sent → for_pullout → repossessed) is deliberately **not** auto-advanced by serving a demand letter — serving a letter and electing to repossess are separate decisions.
- Repossessing cancels the sale. The contract is then closed, not collected on.

**Unresolved question (needs a lawyer):** past repossessions kept all payments made, under a contract that is silent on forfeiture. Do not build features that assume payment forfeiture is fine.

## Article 1308 — mutuality of contracts

A contract's price cannot be revised by one party alone, and notifying the customer does not cure the defect. This is why **term repricing** (migration 0022) works the way it does:

- Repricing is framed as a *conditional discount that lapses on an objective event the customer controls* (the Good-as-Cash term elapsing with a balance), enforced in SQL.
- It is **two-step and never automatic**: `propose_reprice` drafts an amendment (`/print/amendment/[id]`) → the customer signs → `confirm_reprice` applies it. `revert_reprice` restores the original if they settle.
- Existing contracts always need a **signed amendment** — the printout exists precisely for the signature.

## Article 1169 — default requires demand

A customer is not legally in default until demand is made. The demand letter is that demand. `DEMAND_DEADLINE_DAYS` (15 days) sets the compliance window, inside the customary 10–30-day range.

Related: `followup_tier` keys on time since **last payment**, so an account that has never paid can never reach the `demand` tier automatically — review those by hand (see the gotcha in CLAUDE.md).

## RA 3765 — Truth in Lending Act

The printed contract (`/print/contract/[id]`) discloses the amount financed, the finance charge in pesos, and the simple annual rate. Keep those disclosures if the print layout is redesigned.

## RA 10173 — Data Privacy Act

Never disclose a debt to anyone but the debtor. A neighbour, a relative, a co-worker — telling any of them why a collector is visiting is a violation. Consequences:

- The collections SOP's "nobody home" script (`/collections/sop`) says nothing about the purpose of the visit.
- The collection group chat (`customers.collection_gc_url`) contains only owner, admin, collector, and the customer.
- Collectors see the group chat link only; the customer's personal Messenger link stays on the contract/customer pages.

## SEC Memorandum Circular 18 — collection conduct

Followed as the conduct standard even though E & J is not a financing company registrant: no threats, no obscenity, no public shaming, contact only between 6 AM and 10 PM. The three follow-up message tiers in `src/lib/messages.ts` (check-in → friendly overdue → formal demand) are written to this standard.

## Labor rules that shaped payroll

- **13th-month pay** is 1/12 of *basic* salary; the law excludes allowances, overtime premiums, and holiday-pay premiums. `payslips.basic_pay` is therefore `sum(hours_worked × hourly_rate)` — **not** `dtr_pay`, which bakes holiday multipliers in. On a test period, 40% of `dtr_pay` would have been wrongly included. See `docs/modules/payroll-dtr.md`.
- **Meal allowance** (`employee_rates.meal_allowance_per_day`) is paid per day actually worked and kept in its own column precisely so it stays out of the 13th-month base.
- **Art. 296 (probationary employment)**: an employee's contract must be signed *before* they start work. (This drove Roger Dasal's onboarding sequence in July 2026.)
- Holiday pay: worked regular holiday ×2.00, worked special ×1.30, unworked regular holiday pays 8 hours only on weekdays. The math lives only in SQL (`dtr_hours()`, `v_dtr_days`).

## Terms of sale (business policy, not law)

- Downpayment is always 25% of cash price.
- 4- and 5-month Good-as-Cash: total = cash price (no finance charge).
- 6-month: total = cash×1.3×0.75 + cash×0.25.
- 12-month: total = cash×1.5×0.75 + cash×0.25.
- Cash sale: modelled as `term_months = 0`, downpayment = total = cash price, monthly = 0.
- Commission: 10% of `cash_price`, snapshotted at contract creation, earned when the downpayment is fully paid.
- GCash for remote payment: Ruel Ryan Rosal, 09069029261 (constants in `COMPANY`, `src/lib/messages.ts`).

Changing any formula means changing **both** `computeTerms` (TS) and `compute_terms` (SQL) and re-running `npm test` plus `npx tsx scripts/verify-sql-terms.ts` — see `architecture.md`.
