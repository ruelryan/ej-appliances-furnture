# Database Reference

Everything of consequence in this app lives in Postgres (Supabase project `trjlqcvhrgggcvsxxaml`), defined by migrations `supabase/migrations/0001` through `0027`. The schema follows three rules with almost no exceptions: money and time math live in SQL (functions and views), all writes go through `SECURITY DEFINER` RPC functions that generate race-safe IDs from `id_counters`, and Row Level Security scopes what each role can read. This document catalogs the 28 tables by module, the views (including the frozen-view rules that have bitten this project twice), the full RPC catalog with role guards, and the triggers. For how the app calls into all this, see [architecture.md](architecture.md); for the role model, see [roles-and-permissions.md](roles-and-permissions.md); for why some of these rules exist legally, see [business-rules-legal.md](business-rules-legal.md).

## Tables

### Core (0001, plus columns added by later migrations)

| Table | Purpose | ID series |
|---|---|---|
| `profiles` | Mirrors `auth.users`; holds `role` and `active` | (uuid = auth user id) |
| `customers` | Customer master, contact links, structured address, GPS | uuid |
| `contracts` | Installment (and cash) sales; snapshotted money columns | `YYYY###` (per-year scope `contract:YYYY`) |
| `payments` | Money received; voided, never deleted | `PAY####` (scope `payment`) |
| `contract_notes` | Timestamped free-text notes per contract | uuid |
| `audit_log` | Field-level change history, written by triggers | bigint identity |
| `id_counters` | Race-safe counters behind every business ID series | — |

- **`profiles`** — `id uuid` FK to `auth.users` (cascade delete), `full_name`, `role` (CHECK: `owner`, `admin`, `collector`, `sales_agent`, `delivery`, plus legacy `staff` kept during transition — widened in 0011), `active boolean`. A row is auto-created by the `handle_new_user` trigger on signup. Hourly rates are deliberately NOT here — `profiles` is readable by every active user, so pay lives in `employee_rates`.
- **`customers`** — `last_name`/`first_name` with a generated `display_name` (`last, first`), `phones text[]`, and two distinct Messenger links (0020): `messenger_url` (the customer's personal FB profile) and `collection_gc_url` (the collection group chat the admin creates after the sale — collectors see only this one). `address` is the free text as originally given, kept as the audit trail; the structured form (0023) is `province`/`municipality`/`barangay` (validated against `ph_locations`), `street_purok`, `landmark`, plus `lat`/`lng`/`gps_accuracy_m`/`gps_tagged_by`/`gps_tagged_at` for the collector-tagged pin. `gps_url` (legacy opaque Maps link) also stays. Trigram index on `display_name` for search.
- **`contracts`** — the heart of the system. `contract_no` unique, `customer_id` FK. Money columns `cash_price`, `total_price`, `downpayment`, `monthly_amortization` are **snapshotted by `create_contract()` and never recomputed**; since 0022 a `before update` trigger (`guard_contract_money`) rejects any change to them (or `term_months`) outside `confirm_reprice`/`revert_reprice`. `term_months` CHECK: 4/5/6/12 for `sale_type='installment'`, exactly 0 for `sale_type='cash'` (0016). `item_type` CHECK: `Appliances`/`Furniture`/null (0003). Assignment FKs `collector_id`, `agent_id` and `collection_priority` (0011/0012); `product_id` (0015). Status columns: `payment_status` (`open`/`closed`, owner closes), `delivery_status` (legacy text, now a trigger-synced label derived from `deliveries.status` — never hand-edited), and `repossession_stage` (0027: `none` → `letter_prepared` → `letter_sent` → `for_pullout` → `repossessed`, owner-only). The old hand-typed `collection_status` column was **dropped** in 0027.
- **`payments`** — `payment_no` unique, `amount > 0`, `receipt_no`/`receipt_type`/`reference_no` (the payer's online ref — not the collector's booklet number, see `collection_entries.or_no`). Void columns (`voided_at`/`voided_by`/`void_reason`) instead of deletion; every financial view filters `voided_at is null`.
- **`contract_notes`** — append-mostly notes; insert requires `created_by = auth.uid()`, edit/delete owner-only. Repricing writes human-readable notes here alongside the audit log.
- **`audit_log`** — one row per changed field, written by the `audit_row_changes()` trigger on updates to contracts, payments, customers, time_records, employee_rates, time_correction_requests, and payslips. Owner-only read; nobody writes directly.
- **`id_counters`** — `scope text` PK (`contract:2026`, `payment`, `product`, …) + `last_value`. `next_counter(scope)` does an upsert-then-increment inside one statement, so concurrent inserts never collide. **Gotcha:** a Sheet re-import wipes this table and reseeds only contract/payment scopes; 0025 repairs every counter from the rows actually present and is idempotent — re-run it if any `*_no` unique violation appears after an import.

ID series and their scopes: `YYYY###` (`contract:YYYY`), `PAY####` (`payment`), `CE####` (`collection_entry`), `CA####` (`cash_advance`), `COM####` (`commission`), `LEAD####` (`lead`), `DEL#####` (`delivery`), `PRD####` (`product`, used as `products.sku`), `TSK####` (`task`), and `AMD####` (`repricing`, on `contract_repricings.amendment_no`).

### DTR — daily time record (0005–0008, 0010)

- **`time_records`** — one block per employee per day (`unique (profile_id, work_date)`), Manila local `time_in`/`time_out`, `time_out > time_in` CHECK (no overnight shifts — split across two days). 0010 added punch coordinates (`in_lat`/`in_lng`/`in_accuracy_m` and the `out_*` trio) for the geofence audit trail. Staff read only their own rows; no insert/update policies — punches go through `clock_in`/`clock_out`.
- **`holidays`** — `holiday_date` PK, `type` `regular`|`special`. Seeded 2025 (0008, per proclamation) and 2026–2030 (0005, computed — includes Meeus-algorithm Easter for Holy Week). Owner adds proclaimed moveable dates (Eid, Chinese New Year) directly via RLS in /dtr/settings.
- **`employee_rates`** — PK `id` references `profiles` (named `id` so `audit_row_changes()` works unmodified). `hourly_rate`, six government-contribution columns (`philhealth_ee/er`, `sss_ee/er`, `pagibig_ee/er`, 0009) and `meal_allowance_per_day` (0026, deliberately a separate column so it stays out of the 13th-month base). Each user reads only their own row; owner reads all; writes only via `set_hourly_rate`/`set_contributions`/`set_meal_allowance`.
- **`time_correction_requests`** — staff cannot edit punches; they file a request (`requested_time_in/out`, mandatory `reason`) with a partial unique index enforcing one pending request per person per day. Owner approves (which upserts the times into `time_records`) or rejects.
- **`dtr_locations`** — geofence circles (`lat`/`lng`/`radius_m` 25–5000). Enforcement is on iff at least one active row exists — an empty table is the kill switch. Owner manages directly via RLS.

### Payroll (0009, 0026)

- **`payslips`** — semi-monthly (CHECK: `period_start` day is 1 or 16). Every amount is a SNAPSHOT set by `payslip_recompute` — DTR pay, `basic_pay` (0026: `sum(hours_worked × hourly_rate)`, the ×1.00 portion only, which is the 13th-month base; NOT `dtr_pay`, which bakes in holiday multipliers), `meal_allowance` (per day actually worked), the six contribution columns (zero on 1–15 slips; deducted only on 16–end), jsonb `extra_income`/`extra_deductions` (validated by immutable `payslip_lines_valid`), and the totals. Status `draft` → `final`; staff RLS sees only their own **final** slips; wrong finals are reopened, never deleted.
- **`thirteenth_month_payments`** — payouts against the entitlement computed by `v_thirteenth_month`. Owner writes via `record_13th_month_payment`; staff read their own rows.

### Collections (0012, 0021)

- **`collection_entries`** — the collector's daily log and the bridge to real payments. `entry_no` `CE####`, `disposition` (`collected`/`promised`/`not_available`/`refused`), `status` (`pending`/`posted`/`cancelled`), `method` (`cash`/`online`), `payment_id` set when posted. **A row here is NOT a payment** until owner/admin runs `post_collection_entry`, which calls `record_payment`. 0021 added `promised_date` (required when disposition is `promised` — a promise with no date cannot be followed up) and `or_no` (the collector's pre-numbered field receipt booklet — distinct from `reference_no`, the payer's online ref, and from `payments.receipt_no`, assigned later at posting; required for cash). Collector reads own rows only.
- **`cash_advances`** — gasoline/collection-expense floats, `CA####`. Lifecycle `requested` → `open` (approved/issued) → `closed` (reconciled), or `declined`.
- **`cash_advance_expenses`** — receipts logged against an open advance (cascade delete with the advance).

### Commissions and leads (0013)

- **`commissions`** — one per contract (`contract_id` unique), `COM####`. `base_amount` is a **snapshot of `cash_price`** at assignment, `rate` default 0.10, `commission_amount` snapshotted — this is why repricing never touches `cash_price`. Status is derived in `v_commissions`: pending → earned (when the downpayment is fully paid per `v_contract_dp`) → paid (`paid_at` set by `mark_commission_paid`), or voided.
- **`leads`** — agent-submitted prospects, `LEAD####`. `new` → `converted` (linked to the resulting contract) or `rejected`.

### Deliveries and suppliers (0014)

- **`suppliers`** — plain reference table (name/contact/active); owner/admin manage directly via RLS (the only business table besides holidays/dtr_locations/ph_locations written without an RPC).
- **`deliveries`** — exactly one per contract (`contract_id` unique, `DEL#####`), auto-enqueued as `pending` by the after-insert trigger on `contracts`. Status: `pending` → `in_stock`/`to_order` → `ordered` → `delivered` (or `cancelled`). Supplier cost, `ordered_at`/`paid_at`, invoice tracking (`invoice_ref`, `invoice_received_at` — `v_deliveries` computes days-awaiting-invoice), `product_id` (0015). Its status changes are mirrored into the legacy `contracts.delivery_status` text by trigger.

### Inventory and catalog (0015, 0018, 0019, 0024)

- **`products`** — `sku` = `PRD####`, `name`, `category`, `on_hand`, `default_cost`, `price` (selling price, 0018 — pre-fills the new-sale form), `description` (0019), `active`, and `review_status` (`pending`/`approved`, 0024 — items added mid-contract land as `pending` for the duplicate-review queue). All writes RPC-only so the ledger stays complete.
- **`stock_movements`** — the on_hand audit ledger; `reason` CHECK `restock`/`delivery`/`adjust`, optional `delivery_id`. `mark_delivered` writes a negative `delivery` row only when the delivery was fulfilled from office stock (`in_stock` + linked product); drop-shipped supplier orders never touch stock. Read is owner/admin only.
- **`product_photos`** — rows pointing at the **public Storage bucket `product-photos`** (public read so `<img src>` needs no signed URL; writes gated to owner/admin by storage policies). 0024 added `dhash bit(64)`, a browser-computed perceptual hash for near-duplicate ranking. Note the measured caveat: on this white-background catalog dHash separates poorly — only ≤2 bits is treated as evidence; name similarity leads.

### Tasks (0017)

- **`tasks`** — `TSK####`; assigned to exactly one of a person (`assignee_id`) XOR a team (`assignee_role`), enforced by CHECK. Optional `contract_id`/`customer_id` links, `priority`, `status` (`open`/`in_progress`/`done`/`cancelled`), `due_date`. Visibility = owner, creator, assignee, or member of the assigned team (`can_see_task()`). The product-review flow (0024) reuses tasks as its notification channel.
- **`task_comments`** — thread per task, cascade delete, visibility inherited via `can_see_task`.

### Addresses (0023)

- **`ph_locations`** — the delivery coverage area: `(province, municipality, barangay)` unique. Seeded from the Sheet's "Delivery Locations" tab by `scripts/import-locations.ts` (2,141 barangays, 62 municipalities: Southern Leyte, Leyte, Tacloban City). `set_customer_address` validates against it so a typo cannot invent a barangay and split a collector's route.

### Repricing (0022)

- **`contract_repricings`** — the amendment history, `AMD####`. Stores `from_term/from_total/from_monthly` and `to_*`, `status` (`pending` → `signed`, or `reverted`/`cancelled`) with a partial unique index allowing one pending proposal per contract. Doubles as the source of truth for the **originally signed** terms (the print page reads `v_contract_original_terms` so a reprice never puts new figures above an old signature).

## Views

All views are declared `with (security_invoker = true)`, so they inherit the caller's RLS — a collector querying `v_contract_collections` sees only contracts assigned to them, with no extra predicate in the view.

### The frozen-view rules (read this before touching any view)

Two hard-won rules, both hit in 0020 and again in 0023:

1. **`v_contract_financials` enumerates its columns by hand — never `c.*`.** 0002 originally wrote `select c.*`, which Postgres expanded and froze to the 19 `contracts` columns of 0001. The table has since grown; re-declaring with `c.*` would splice the new columns into the middle and `create or replace view` fails with "cannot change name of view column". New columns are appended LAST (trailing additions are the only change `create or replace` accepts). Keep it enumerated.
2. **`v_contract_collections` is `select f.*` and does NOT inherit new columns.** Its star was expanded at creation. It must be **DROPPED and recreated**, never `create or replace`d. After any change, verify with `select <newcol> from v_contract_collections limit 1`.

And the drop-order dependency, learned in 0027: **when you DROP `v_contract_financials` (required to remove a column from its output), FOUR views depend on it** — `v_contract_collections` plus the analytics views `v_aging`, `v_dashboard_stats`, `v_top_customers`. Drop all four first, then the financials view, then recreate all five (get live definitions with `select pg_get_viewdef('public.v_aging'::regclass, true)` before dropping).

`v_deliveries` was the trap's third victim: its `d.*` froze at 0014's columns, so it silently lacked `deliveries.product_id` (added 0015) until 0028 dropped and recreated it with hand-enumerated columns. Assume any `select x.*` view has this problem.

### Catalog

| View | Defined | Purpose |
|---|---|---|
| `v_contract_financials` | 0002, redefined 0020/0023/0027 | **The single source of truth for every time-dependent number**: `months_elapsed`, `expected_to_date`, `overdue_amount`, `remaining_balance`, `months_since_last_payment`, `followup_tier`, and (0027) the derived `collection_situation`. "Today" is always `ph_today()` = Asia/Manila. Never recompute any of these in JS. |
| `v_contract_collections` | 0012, drop+recreated 0020/0023/0027 | Financials + assignment (`collector_id`, `agent_id`, `collection_priority`, collector name). The collector worklist filters and orders this view — there is no separate worklist object. |
| `v_contract_dp` | 0013 | Downpayment-paid signal (`dp_paid`, `dp_paid_date` via running payment total). Separate view precisely because `v_contract_financials` could not be cleanly re-created. Drives commission earning. |
| `v_commissions` | 0013 | Commission rows + contract + dp signal, with derived status pending/earned/paid/voided. |
| `v_deliveries` | 0014, drop+recreated 0028 | Delivery queue with contract/customer/supplier context and `days_awaiting_invoice`. 0028 enumerated its columns (repairing the frozen `d.*` that had hidden `product_id`) and added the customer's structured address (`province`/`municipality`/`barangay`/`street_purok`/`landmark`) and tagged `lat`/`lng` so `/deliveries` renders `formatAddress()` + `directionsUrl()` like the collector worklist. |
| `v_dtr_days` | 0005, replaced 0006 | Per-day DTR rows: real punches with `hours_worked` (from `dtr_hours()`, lunch-hour-aware), holiday multiplier (worked regular ×2.00, special ×1.30) and `day_pay`; plus synthetic rows for UNWORKED past regular holidays (8h × rate) — weekdays only (0006 rule), counted from an employee's first recorded day, and carrying `hours_worked = 0` (which is what makes the 13th-month `basic_pay` expression correct with no special-casing). |
| `v_dtr_month` | 0005 | Monthly roll-up of `v_dtr_days` (days worked, open records, total hours/pay, rate-missing flag). |
| `v_open_promises` | 0021 | One row per contract: the most recent pending promise whose date has arrived. Floats those accounts to the top of the worklist. |
| `v_collector_day` | 0012 | Per-collector per-day roll-up of collection entries (counts by disposition, cash/online/posted/pending totals) — the daily report and remittance-reconcile basis. |
| `v_thirteenth_month` | 0026 | Per employee per year: `basic_earned` from **final** payslips only, `entitlement` = basic/12, payments to date, balance. |
| `v_contract_original_terms` | 0022 | The originally signed term/total/monthly (first signed amendment's `from_*`, else the live row) for the printed contract. |
| `v_aging` | 0002, recreated 0027 | Open contracts bucketed by how many amortization-months behind. Depends on `v_contract_financials`. |
| `v_dashboard_stats` | 0002, recreated 0027 | One-row dashboard aggregates (open contracts, outstanding, overdue, tier counts, collected this month). Depends on `v_contract_financials`. |
| `v_top_customers` | 0002, recreated 0027 | Lifetime value and current balance per customer. Depends on `v_contract_financials`. |
| `v_sales_monthly`, `v_sales_by_agent`, `v_sales_by_item_type`, `v_cashflow_monthly`, `v_expected_monthly`, `v_collections_vs_expected` | 0002 | The remaining analytics views. These read `contracts`/`payments` directly and do NOT depend on `v_contract_financials`. Note: the sales views sum `total_price` bucketed by `contract_date`, so a reprice restates a past month's reported sales (reconstructible from `contract_repricings`). |

`followup_tier` logic (in `v_contract_financials`): `closed` → `on_track` (balance ≤ 0 or expected-to-date covered) → `demand` (last payment 3+ months ago, ÷30.44 fractional months) → else `overdue`. Because the demand test keys on *last payment date*, **an account that has never paid can never reach `demand`** — review those by hand.

## RPC catalog

Every write entry point is a `SECURITY DEFINER` function with `set search_path = public`, guarded internally by the role helpers. The helpers (all `stable security definer`, reading `profiles` by `auth.uid()`):

| Helper | True for |
|---|---|
| `is_owner()` | active owner |
| `is_active_user()` | any active profile |
| `can_post_payments()` | active owner or admin (0011) |
| `is_collector()` / `is_sales_agent()` / `is_delivery()` | that active role |
| `my_role()` | returns the caller's role text (0017) |
| `can_see_task(task_id)` | owner / creator / assignee / assigned-team member |

**Overload gotcha:** `create or replace function` with a changed argument list creates an OVERLOAD, and PostgREST `rpc()` then resolves ambiguously. Always `drop function` with the full old signature first (done in 0010 for `clock_in`/`clock_out`, 0013/0015/0016 for `create_contract`, 0018/0019 for the product functions, 0021 for `log_collection`).

### Core contracts and payments

| Function | Guard | Purpose |
|---|---|---|
| `create_contract(customer, date, item, type, qty, cash_price, term, sales_agent, note?, agent_id?, product_id?, sale_type?)` | owner/admin | Creates the contract with snapshotted terms from `compute_terms()` (or the term=0 cash shape), YYYY### number, optional note, and an inline commission row when `agent_id` is set. Current signature is the 12-arg 0016 version. |
| `record_payment(contract, date, amount, receipt_no, receipt_type, reference_no?)` | owner/admin | Inserts a `PAY####` payment. The only path into `payments`. |
| `void_payment(id, reason)` / `unvoid_payment(id)` | owner | Void / restore — payments are never deleted. |
| `close_contract(id)` | owner | Sets `payment_status = 'closed'`. |
| `set_repossession_stage(contract, stage)` | owner | 0027. The only remaining manual collection status. Deliberately not auto-advanced by printing the demand letter. |
| `next_counter(scope, start?)` | internal | Race-safe upsert-and-increment on `id_counters`; called by the other RPCs. |
| `compute_terms(cash_price, term)` | pure (immutable, not definer) | The SQL twin of `computeTerms()` in `src/lib/amortization.ts` — change both or neither. |

Removed: `update_contract_status` (dropped in 0027 along with the `collection_status` column it edited).

### Customers

| Function | Guard | Purpose |
|---|---|---|
| `set_customer_links(customer, messenger_url?, collection_gc_url?)` | owner/admin | 0020. Edits the two Messenger links (null = leave, '' = clear). Collectors must not be able to repoint the group chat. |
| `set_customer_address(customer, province, municipality, barangay, street_purok?, landmark?)` | owner/admin | 0023. Validates the triple against `ph_locations`. |
| `tag_customer_gps(customer, lat, lng, accuracy?)` | collector (own worklist only), owner, admin | 0023. Deliberately open to the collector — the only person at the door. Coordinates are client-supplied (deterrent + audit trail, not proof). |
| `set_customer_landmark(customer, landmark)` | same as `tag_customer_gps` | 0023. |

### DTR

| Function | Guard | Purpose |
|---|---|---|
| `clock_in(lat?, lng?, accuracy?)` / `clock_out(...)` | any active user | One block per Manila day; minutes-truncated. Both call `check_dtr_geofence` (no-op when no active `dtr_locations` row; otherwise blocks outside `radius_m + min(accuracy, 100m)` of the nearest active location and points the user at the correction flow). `check_dtr_geofence` itself has EXECUTE revoked from the API so the fence cannot be probed. |
| `upsert_time_record(profile, date, in, out?, note?)` / `delete_time_record(id)` | owner | Manual corrections/entries. |
| `set_hourly_rate(profile, rate)` | owner | Upserts `employee_rates`. |
| `request_time_correction(date, in, out?, reason)` | any active user | Staff-side fix request; future dates rejected; one pending per day. |
| `cancel_time_correction(id)` | requester (own pending) | Withdraw. |
| `resolve_time_correction(id, approve)` | owner | Approve applies the times to `time_records` (upsert, reason becomes the note); reject just closes it. |

Pure helpers: `dtr_hours(in, out)` (span minus overlap with the 12:00–13:00 lunch hour — the ONLY place hours math exists, no TS twin), `easter_date(year)`, `distance_m(...)` (haversine), `ph_today()`, `months_elapsed_ph(date)`.

### Payroll

| Function | Guard | Purpose |
|---|---|---|
| `set_contributions(profile, ph_ee, ph_er, sss_ee, sss_er, pi_ee, pi_er)` | owner | Fixed monthly amounts on `employee_rates` (requires the rate to exist first). |
| `set_meal_allowance(profile, amount)` | owner | 0026. Separate from `set_contributions` on purpose. |
| `create_payslip(profile, period_start)` | owner | Validates 1st/16th start, period finished, then snapshots via recompute. |
| `update_payslip_lines(id, income, deductions)` / `refresh_payslip(id)` | owner | Draft-only edits; both re-run the recompute. |
| `finalize_payslip(id)` / `reopen_payslip(id)` / `delete_payslip(id)` | owner | Draft → final (recomputed at that moment); finals reopen rather than delete; only drafts can be deleted. |
| `payslip_recompute(id)` | internal | Snapshots DTR hours/pay, `basic_pay`, meal allowance, contributions (16–end only), and totals. Refuses if any punch in the period is missing a clock-out. |
| `record_13th_month_payment(profile, year, amount, paid_on?, note?)` | owner | 0026. |

### Collections

| Function | Guard | Purpose |
|---|---|---|
| `assign_collector(contract, collector?, priority?)` | owner/admin | Assign/reassign/unassign; assignee must be an active collector. |
| `log_collection(contract, amount, method, reference, disposition?, note?, promised_date?, or_no?)` | collector, own assignment only | The collector's ONLY write into the money flow — a `CE####` entry, not a payment. Enforces: collected needs amount+method, online needs a reference, cash needs the booklet `or_no` (0021), promised needs a non-past `promised_date` (0021). |
| `post_collection_entry(entry, receipt_no, receipt_type)` | owner/admin | Turns a pending `collected` entry into a real payment via `record_payment`, links `payment_id`. |
| `cancel_collection_entry(entry, reason?)` | owner/admin any; collector own | Pending entries only. |
| `request_cash_advance(amount, purpose?)` | collector | `CA####`, status `requested`. |
| `issue_cash_advance(collector, amount, purpose?)` | owner/admin | Direct issue (skips the request), status `open`. |
| `approve_cash_advance(id)` / `decline_cash_advance(id, reason?)` | owner/admin | requested → open / declined. |
| `add_advance_expense(advance, description, amount, receipt_ref?)` | owner/admin, or collector on own open advance | Receipt lines. |
| `close_cash_advance(id)` | owner/admin | After reconcile. |

### Commissions and leads

| Function | Guard | Purpose |
|---|---|---|
| `set_contract_agent(contract, agent?)` | owner/admin | Assign/reassign/clear the agent and keep the commission row in sync (creates/deletes/repoints; refuses once paid). |
| `mark_commission_paid(id, reference?)` | owner/admin | Refuses unless `v_contract_dp.dp_paid` — commission is earned only when the downpayment is fully paid. |
| `unmark_commission_paid(id)` / `void_commission(id, reason)` | owner | Corrections / cancelled deals. |
| `submit_lead(name, phone, address, messenger, item, type, est_price, note)` | sales_agent | `LEAD####`. |
| `reject_lead(id, reason?)` / `mark_lead_converted(id, contract)` | owner/admin | Resolve the pipeline. |

### Deliveries

| Function | Guard | Purpose |
|---|---|---|
| `set_delivery_availability(delivery, in_stock)` | delivery or owner/admin | pending/in_stock/to_order toggle. |
| `record_supplier_order(delivery, supplier, cost, ordered?, paid?)` | owner/admin | Cost is office-only; status → `ordered`. |
| `record_supplier_invoice(delivery, ref, received?)` | owner/admin | Invoice-lag tracking. |
| `mark_delivered(delivery, note?)` | delivery or owner/admin | Marks delivered; decrements `products.on_hand` and writes a `stock_movements` row ONLY when status was `in_stock` with a linked product (0015 version). |
| `set_delivery_product(delivery, product)` | delivery or owner/admin | Link a catalog item. |

### Inventory and catalog

| Function | Guard | Purpose |
|---|---|---|
| `create_product(name, category?, cost?, price?, description?)` | owner/admin | `PRD####`; current 5-arg 0019 signature. |
| `update_product(id, name, category, price, cost, active, description?)` | owner/admin | 0019 signature. |
| `restock_product(id, qty, note?)` / `adjust_stock(id, delta, note?)` | owner/admin | Both write `stock_movements`; adjust refuses to go negative. |
| `add_product_photo(product, storage_path, sort?)` / `delete_product_photo(id)` | owner/admin | Delete returns the storage path so the caller removes the file. |
| `search_products(query)` | any authenticated (definer) | 0024 typeahead. Uses `word_similarity` (threshold 0.45) + substring boosts — an RPC because PostgREST cannot order by a similarity function. Do not switch to `similarity()`; see CLAUDE.md. |
| `create_product_for_contract(name, category?, price?, description?)` | owner/admin | 0024. Like `create_product` but `review_status='pending'` + files an admin task. Deliberately separate so /products can never set the flag by accident. |
| `find_duplicate_candidates(product)` | definer (called from review UI) | Name-similarity-ranked suspects with photo path + dhash; image distance is combined in TS. |
| `set_product_photo_hash(storage_path, dhash)` | owner/admin | Backfills/sets the 64-bit dHash. |
| `approve_product(id)` | owner/admin | pending → approved. |
| `merge_products(duplicate, keep)` | owner/admin | Repoints contracts/deliveries/stock_movements/photos, folds stock in, deletes the duplicate, logs an audit task. **Irreversible.** |

### Tasks

| Function | Guard | Purpose |
|---|---|---|
| `create_task(title, body?, assignee_id?, assignee_role?, priority?, due?, contract?, customer?)` | any active user | Exactly one of person XOR team. |
| `set_task_status(task, status)` | owner / creator / assignee / team member | Manages `completed_at/by` on done. |
| `reassign_task(task, assignee_id, assignee_role)` | owner or creator | |
| `add_task_comment(task, body)` | anyone who `can_see_task` | |

### Repricing (0022)

| Function | Guard | Purpose |
|---|---|---|
| `propose_reprice(contract, new_term, reason?)` | owner/admin | Drafts an `AMD####` amendment. SQL enforces the objective trigger: escalation only along 4/5→6→12, term elapsed, balance outstanding, not a cash sale, not closed. Contract untouched. |
| `confirm_reprice(amendment, signed_date?)` | owner/admin | Applies `to_*` to the contract **only after the customer has signed** — the sole path through the money-columns guard trigger (via the `app.allow_terms_change` setting). Writes a contract note. |
| `revert_reprice(contract, reason?)` | owner/admin | Restores the FIRST signed amendment's original terms (the catch-up right when the customer settles). |

`cash_price` and `downpayment` never change through any of these — that invariant is what keeps commissions (snapshot of `cash_price`) and `v_contract_dp.dp_paid` correct.

## Triggers

| Trigger | On | Function | What it does |
|---|---|---|---|
| `on_auth_user_created` | `auth.users` insert | `handle_new_user()` | Auto-creates the `profiles` row (default role from the CHECK; owner sets the real role from /admin). |
| `audit_contracts` / `audit_payments` / `audit_customers` (+ DTR/payroll siblings) | after update | `audit_row_changes()` | Diffs old vs new jsonb and writes one `audit_log` row per changed field (skips `created_at`/`updated_at`). |
| `touch_*` | before update | `touch_updated_at()` | Keeps `updated_at` fresh on contracts, customers, time_records, employee_rates, correction requests, payslips, deliveries, tasks. |
| `contracts_enqueue_delivery` | after insert on `contracts` | `enqueue_delivery()` | Creates the one `deliveries` row (`DEL#####`, status `pending`, copying `product_id`) for every new contract — including cash sales. |
| `deliveries_sync_status` | after insert/update-of-status on `deliveries` | `sync_contract_delivery_status()` | Mirrors the delivery status into the legacy `contracts.delivery_status` label (keeps old displays and the CSV export working; the label is derived, never hand-edited). |
| `guard_contract_money` | before update on `contracts` | `guard_contract_money_columns()` | 0022. Rejects any change to `cash_price`/`total_price`/`downpayment`/`monthly_amortization`/`term_months` unless the transaction-local `app.allow_terms_change` setting is on — which only `confirm_reprice`/`revert_reprice` set. Closes the hole where the owner's blanket UPDATE policy allowed PATCHing money columns straight through PostgREST. |

## RLS philosophy

Postgres is the enforcement layer; everything else is convenience. Every table has RLS enabled with SELECT policies scoped by role (owner/admin see everything money-related; collectors and sales agents see only rows tied to their own assignments; staff see their own DTR/payslips), and almost no table has INSERT/UPDATE/DELETE policies at all — writes happen exclusively inside `SECURITY DEFINER` RPCs that check the role helpers themselves. Because the views are `security_invoker`, the same row scoping flows through them automatically. Hiding a nav link (`nav-links.tsx` allowlists) or redirecting a page (see [roles-and-permissions.md](roles-and-permissions.md)) only tidies the UI: a collector who crafts a request to `/payments` gets an empty-or-scoped result set from RLS and a hard exception from `record_payment`, regardless of what the UI showed. When adding a feature, write the SQL guard first and treat the UI gate as decoration. One deliberate consequence: one-off scripts authenticate with the service-role key, which bypasses RLS — an RPC guarded by `can_post_payments()` will always refuse a script because `auth.uid()` is null, so scripts write tables directly (see [operations.md](operations.md)).
