# Collections

Collections is the field side of the money flow: a collector works an assigned worklist, knocks on doors, and **logs** what happened — but never posts a payment. A `collection_entries` row is NOT a payment until the owner or admin posts it back at the office (`post_collection_entry` → `record_payment`), which is what keeps a single, receipt-numbered payment ledger while still capturing every visit, including the ones that collected nothing. Accountability is deliberately built on a **daily report plus remittance reconcile** (`v_collector_day`), not per-visit GPS surveillance. The module is migration 0012 (entries, advances, views, RPCs) plus 0021 (promise dates and field receipt numbers), with the customer-facing pieces from 0020 (the two Messenger links) and 0023 (structured addresses and collector GPS tagging). Routes: `/collections` (role-split board), `/collections/report`, `/collections/sop`. Table and view shapes are cataloged in [../database.md](../database.md); this page covers how the flow actually works.

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

## Daily report and remittance

`/collections/report` renders `v_collector_day` for a chosen date (`?date=`, default today): per collector, counts by disposition and the cash / online / posted / pending-to-post totals, plus the detailed entry list. RLS scopes a collector to their own rows; owner/admin see everyone. The reconcile ritual is simple: the collector's physical cash plus booklet receipts must match `cash_total`, and the SOP's hard rule is **remit everything by 4:30 PM the same day** — cash never goes home. `pending_total` (collected but not yet posted) is surfaced as an alert tile because it is exactly the money in transit between field and ledger.

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
