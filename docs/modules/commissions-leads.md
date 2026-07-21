# Commissions and Leads

Sales agents are freelancers who bring in installment customers; this module (migration 0013, on the role scaffolding of 0011) pays them 10% of each deal's cash price once the customer has fully paid the downpayment, and gives them a lead pipeline to feed prospects to the office. Three design decisions carry the whole module: the commission amount is a **snapshot of `cash_price` taken at assignment** (so later repricing can never change what an agent is owed — see [contracts-payments.md](contracts-payments.md)); commission **status is derived in a view, never stored** (so it can move backwards automatically if a payment is voided); and the `sales_agent` role is **deliberately read-restricted** — an outsider with a login sees only their own deals, their own customers, and their own money. Table shapes and the RPC catalog are in [../database.md](../database.md); the role matrix is in [../roles-and-permissions.md](../roles-and-permissions.md).

## The commission lifecycle

A `commissions` row exists one-per-contract (`contract_id` is unique) and is created in exactly two places, both of which snapshot the money:

- **`create_contract(... p_agent_id)`** — when a contract is created with an agent picked, the RPC inserts the commission in the same transaction: `base_amount = cash_price`, `rate = 0.10`, `commission_amount = round(cash_price × 0.10, 2)`, numbered `COM####` from `id_counters`.
- **`set_contract_agent(contract_id, agent_id)`** (owner/admin) — assigning an agent to an existing contract creates the same row from the contract's current `cash_price`. The RPC also keeps the row in sync on reassignment (moves `agent_id`, refuses if the commission was already **paid** to a different agent) and on clearing (deletes the commission, refuses if paid). Both entry points verify the assignee is an active `sales_agent` profile. Assigning also copies the agent's `full_name` into the legacy `contracts.sales_agent` text; clearing the agent leaves that text as it was.

There is no stored status column. `v_commissions` (commission + contract + customer/agent names + the DP signal) derives it:

```
voided_at set        → voided
paid_at set          → paid
dp_paid              → earned      (payable now)
otherwise            → pending     (waiting on the downpayment)
```

Payout is two RPCs, deliberately asymmetric in privilege: `mark_commission_paid` (owner **or admin**; refuses unless the commission is actually earned — it re-checks `v_contract_dp` — and records `paid_at`/`paid_by`/an optional GCash-style `paid_reference`) and `unmark_commission_paid` (**owner only** — reversing a payout is a correction, not a routine action). `void_commission` (owner only, reason recorded) kills the commission on a cancelled deal without deleting the row.

## The DP-paid signal (`v_contract_dp`)

"Earned when the downpayment is fully paid" is money-and-time logic, so it lives only in SQL. It could not be added to `v_contract_financials` (whose frozen column list can't be re-created cleanly — see the frozen-view rules in [../database.md](../database.md)), so 0013 made it a separate view:

- A window function computes each contract's **running payment total** over non-voided payments, ordered by `payment_date, payment_no`.
- `dp_paid_date` is the date of the payment that first pushed the running total past `downpayment`; `dp_paid` is simply `total_paid >= downpayment`.
- Because only `voided_at is null` payments count, **voiding a payment can un-earn a commission**: the derived status falls back from `earned` to `pending` with no bookkeeping. (A commission already marked *paid* stays paid — `paid_at` is a fact about money that left the till; the owner would `unmark` it manually if the situation truly reversed.)

Two shapes fall out correctly with zero special-casing: a **cash sale** (0016) has `downpayment = cash_price`, so its commission is earned the moment the sale is fully paid — usually immediately; and a **repriced contract** keeps its original `cash_price` and `downpayment` untouched (that invariant exists largely *for* this module), so neither `dp_paid` nor the snapshotted amounts move.

Walk-in sales with no agent get `sales_agent = 'Office Sales'` (the RPC defaults blank text to it) and no `agent_id` — so no commission row is ever created for a house sale.

## The lead pipeline

Leads let an agent hand a prospect to the office without having any write access to customers or contracts. Statuses are `new` → `converted` or `rejected`, and only three RPCs touch the table:

1. **`submit_lead`** (sales_agent only) — name and item description required; phone, address, Messenger link, item type, estimated price, and a note optional. Numbered `LEAD####`, stamped with the submitting agent's `auth.uid()`.
2. **Convert** — owner/admin clicks Convert on `/leads`, which is just a link to `/contracts/new?leadId=…`. The new-contract form pre-fills from the lead (name split into first/last, phone, address, Messenger link, item, estimated price as the cash price) **and pre-selects the submitting agent**, so the commission lands with whoever sourced the deal — though the admin can change any of it before saving. After `create_contract` succeeds, the server action calls **`mark_lead_converted`**, which flips the lead to `converted` and links `contract_id`. The two RPCs are not one transaction: if the second call fails (say the lead was resolved by someone else meanwhile), the contract still exists — the action deliberately does **not** fail at that point, because re-submitting the form would create a duplicate sale. Instead it redirects with `?leadWarn=1` and the contract page shows a warning banner telling the admin to check `/leads` and not convert that lead again.
3. **`reject_lead`** (owner/admin) — with an optional reason, shown back to the agent. Both resolve RPCs only act on a lead still in `new`.

On `/leads`, owner/admin see the new-leads queue plus a resolved history; an agent sees the submit form and only their own leads with outcomes (and the reject reason, which is their feedback loop).

## What a sales agent can and cannot see

The `sales_agent` role is the most restricted in the system — RLS, not UI, does the enforcing (0011 and 0013):

| Data | Agent sees |
|---|---|
| Contracts | Only rows where `agent_id = auth.uid()` — their own closed deals |
| Payments | Only payments on those contracts (needed so the DP signal renders) |
| Customers | Only customers tied to one of their contracts (tightened in 0013 — PII of everyone else is invisible) |
| Contract notes | Same own-contract scoping |
| Commissions / leads | Only rows where `agent_id = auth.uid()`; owner/admin see all |
| Everything else | Nothing — no worklist, no DTR/payroll, no products, no analytics |

Agents write nothing except `submit_lead`. `commissions` and `leads` have **no insert/update policies at all** — every change goes through the RPCs above. On login the dashboard redirects a sales_agent straight to `/commissions`; the page gates on `/commissions` and `/leads` admit owner/admin/agent and bounce everyone else (UI convenience — RLS is the real wall).

## The printed statement

`/print/commission-statement/[agentId]` is the settlement document for paying an agent: letterhead, then three sections — **Payable (earned)** with each deal's DP-paid date, **Already paid** with payout date and reference, **Pending** — and a "total payable now" line, ending in signature blocks for the agent and owner. It reads `v_commissions` with the caller's own JWT, so an agent can print only their own statement (there's a Print button on their `/commissions` view) while owner/admin can print anyone's, e.g. before a payout visit. The workflow is: print → pay the payable lines → `mark_commission_paid` each with the payment reference.
