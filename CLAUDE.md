# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

# E & J Appliances Furniture — Business App

Installment-sales management app for a small appliance/furniture retailer in
Southern Leyte, PH. Replaces a Google Sheets + Apps Script system (reference
copy of the old script: `C:\Users\ryan\Downloads\eandjappscript.txt`). Owner:
Ryan (ruelryanrosal@gmail.com) — not a professional developer; explain
technical trade-offs plainly and confirm before destructive actions.

## Status (2026-08-05)

- **Deployed to Vercel**: https://eandj-chi.vercel.app. **Cutover is done** —
  the Sheet was re-imported on 2026-07-20: **1,511 contracts, 1,127 customers,
  5,901 payments (₱24,256,852.39, reconciled to the centavo)**. The Sheet is no
  longer the source of truth; anything recorded there now is a divergence.
- Supabase project `trjlqcvhrgggcvsxxaml`, region **ap-south-1** (pooler:
  `aws-1-ap-south-1.pooler.supabase.com`). Migrations **0001–0032 all applied
  to prod** (0029/0031/0032 applied and verified 2026-08-05, code deployed the
  same day). Catalog: **136 products**, all with photos and perceptual hashes
  (seeded by `scripts/import-pricelist.ts`; 12 duplicates merged out).
- GitHub: `ruelryan/ej-appliances-furnture`. `redesign/fintech-light` has been
  merged into **`main`** (4dee47a) and its local branch deleted — main is now
  current. Branch state (2026-08-05): **`feat/collector-remittances`** is
  checked out and holds 0030 (e655219, pushed, applied to prod) plus the whole
  security/integrity audit — 0029, 0031, 0032 and the app-layer cleanup, all
  committed locally, **none pushed, none applied to prod, nothing merged to
  main**. **`security/rls-and-rpc-hardening`** exists but is **empty — zero
  commits ahead of main**; the 0029 work never lived there despite the name.
  Deploys go from local via `vercel --prod` (linked project "eandj"). An older
  Vite prototype is parked on `old-vite-app` (remote only).
- **Users are now real** — **four** of them (verified in prod 2026-08-05):
  owner Ruel Ryan Rosal, admins Analyn Clemente and **Elvira Rosal** (added
  2026-07-24), collector Roger Dasal. The four sample/test accounts were
  hard-deleted 2026-07-20 (archive: `eandj-data/deleted-test-accounts.json`).
- Beyond the original brief, now also shipped: two Messenger links per
  customer (0020), promise-to-pay + field receipt numbers (0021), term
  repricing (0022), structured addresses + collector GPS (0023), product
  typeahead + duplicate review (0024), meal allowance + 13th-month pay (0026),
  and retiring the hand-typed collection status for a derived one + owner-only
  repossession stage (0027), and collector remittances + entry↔payment linking
  (0030).
- The `docs/` developer reference, the Playwright e2e suite and the rewritten
  `scripts/backup-prod.ts` are now committed (4f3bb78, 9e24f0b).
- **Security + integrity audit (2026-08-05) — APPLIED to prod and deployed.**
  Backup taken first (`eandj-data\backup-2026-08-05-1825`, 28 tables, 20,843
  rows). Migrations went in **before** the code deploy, not after as originally
  planned: the new code calls `unlink_collection_payment` and passes `p_force`,
  neither of which exists until 0031, so deploying first would have broken
  collection posting. The old code kept working throughout because `p_force`
  has a default and PostgREST resolves the 3-arg call to it. Verified from
  outside with the anon key afterwards: `search_products` returns `[]`,
  `next_counter` and `payslip_recompute` return *permission denied*. The four
  commits:
  - **0029 security hardening.** Only ONE `revoke execute` existed in the whole
    schema (`0010:127`), and Postgres grants EXECUTE to `PUBLIC` by default, so
    four SECURITY DEFINER functions with no auth check were callable by anyone
    holding the anon key from the browser bundle: `search_products` and
    `find_duplicate_candidates` (catalogue + selling price + stock),
    `next_counter` (burn the `PAY####` series, leaving gaps that read as
    deleted payments), `payslip_recompute` (rewrite a finalised payslip from
    live rates, inflating the 13th-month base). Also narrows `customers`
    writes to owner/admin (a bare `is_active_user()` walked around four RPCs
    via direct PATCH), scopes `contract_repricings`/`contract_notes`/
    `thirteenth_month_payments`, and makes `handle_new_user` create profiles
    INACTIVE with least privilege. Paired code: `createUser` sets
    `active: true` — **deploy the code before or with the migration** or new
    /admin users land inert — plus export-route pagination + CSV-injection
    escaping and `src/lib/supabase/filters.ts`.
  - **0031 collection integrity.** The `post_collection_entry` double-post race
    (now `for update` + a conditional write), an amount/date check on
    `link_collection_payment` (it compared only `contract_id`, so a ₱10,000
    entry could close against a ₱500 payment), a **unique index** on
    `collection_entries.payment_id`, the new `unlink_collection_payment`, the
    same read-then-write fix on `cancel_collection_entry`/
    `mark_commission_paid`/`add_advance_expense`, **audit triggers on the four
    cash tables**, `cancelled_cash` on the day/month views, and a fix so a role
    change no longer deletes a collector's outstanding cash liability.
  - **0032 payment caps.** `record_payment` refuses a closed contract and any
    amount more than **₱100 over the balance**; `close_contract` no longer
    fails silently. This is the only behaviour change staff will notice.
  - **App-layer cleanup.** `canPostPayments` drops legacy `staff` to match
    `can_post_payments()`, eight hand-typed role triples collapse into it,
    `filters.ts` is wired into all three `.or()` searches, and the six ungated
    print pages now require an active profile.

  **Deliberately NOT changed:** the collector keeps self-cancel (a field
  mis-key should be fixable by the person who made it — the control is the
  audit trail plus `cancelled_cash` on the report); cash-advance expenses are
  still uncapped (overspend-and-reimburse is legitimate, and it is now
  audited); and collectors/delivery still read the whole customer book, which
  `0013:462-463` chose on purpose.
- **Roger Dasal** started as collector 2026-07-22 (Mon–Wed, 3-day week). Rate
  ₱56.25/hr and ₱100/day meal allowance are set; **24 Tomas Oppus accounts
  assigned**. Still open (human, not a commit — last verified in prod
  2026-08-03): his SSS/PhilHealth/Pag-IBIG **amounts are all still zero**, so
  his 16–end slips deduct nothing; whether his contract was signed before he
  started (Art. 296) is unconfirmed. See "Legal watch-outs" below.

## Commands

```
npm run dev      # dev server (localhost:3000)
npm test         # Vitest — amortization golden cases + date math
npx vitest run src/lib/__tests__/amortization.test.ts   # one file (-t "name" for one case)
npm run lint     # ESLint
npm run build    # production build; must pass before commit
npx tsx scripts/check-connection.ts       # env/DB sanity check
npx tsx scripts/apply-migrations.ts 0005  # apply a single new migration
npx tsx scripts/verify-sql-terms.ts       # SQL math vs golden fixture
npx tsx scripts/verify-dtr.ts             # DTR hours/holiday SQL vs fixtures
npm run e2e:readonly                      # Playwright read-only suite — safe any time
npm run e2e:writes   # Playwright write suite — WRITES TO PROD; full procedure in docs/testing.md
npx tsx scripts/e2e/setup-test-users.ts --apply   # create test-*@eandj.test → .env.e2e
npx tsx scripts/e2e/cleanup-test-data.ts          # remove rows the write suite created
npx tsx scripts/e2e/teardown-test-users.ts        # delete the test accounts (same day)
npx tsx scripts/backup-prod.ts            # full JSON dump of all tables → eandj-data\backup-*
npx tsx scripts/migrate/import.ts --dir <csvs> [--load]  # Sheet re-import
npx tsx scripts/extract-tabs.ts <book.xlsx|drive.json> <dir>  # Sheet tabs → CSVs
npx tsx scripts/import-locations.ts --file <book.xlsx> [--load]  # seed ph_locations
npx tsx scripts/import-pricelist.ts [--apply]       # seed catalog + photos + dHashes
npx tsx scripts/import-products.ts [--apply]        # products from a plain list
npx tsx scripts/create-owner.ts                     # bootstrap the first owner account
npx tsx scripts/backfill-addresses.ts [--apply]     # free text → barangay/municipality
npx tsx scripts/backfill-photo-hashes.ts [--apply]  # dHash existing product photos
```

`npm run e2e` (bare) runs **both** suites — it writes to prod. Use the
`:readonly` / `:writes` scripts, never the bare one. `npm test` only picks up
`src/**/*.test.ts` (`vitest.config.ts`), so Playwright specs never leak in.

One-off data scripts follow a house pattern: **dry run by default, `--apply` to
write**, and they print a report before touching anything. They authenticate
with the service-role key, which **bypasses RLS** — so they write tables
directly where the app would have to use an RPC (an RPC guarded by
`can_post_payments()` will always refuse a script, because that reads
`auth.uid()` and a script has no JWT user).

`.env.local` (gitignored) holds Supabase URL/keys and `SUPABASE_DB_PASSWORD`
(quote it — it contains `#`).

## Docs

`docs/` is the developer reference (architecture, database + full RPC catalog,
roles matrix, business/legal rules, testing, operations). **Standing rule: any
commit that changes user-facing behavior, a route, a role's access, a business
rule, or the schema updates the matching `docs/` page in the same commit.** On
drift, the code is the truth — fix the doc. (`docs/README.md` also mentions an
in-app `/help` staff manual that is **not written yet**.)

## E2E suite (Playwright) — runs against PRODUCTION

There is no staging database. `e2e/specs/readonly/` is safe any time;
`e2e/specs/writes/` writes to the live business DB and follows the strict
backup → setup-test-users → run → cleanup-test-data → teardown procedure in
`docs/testing.md`. In `playwright.config.ts`, `workers: 1` and `retries: 0`
are load-bearing (a retry would double-write) — never change them, never run
the suite in CI, and never point it at the Vercel URL. Test accounts
(`test-*@eandj.test`, created by `scripts/e2e/setup-test-users.ts --apply`
into gitignored `.env.e2e`) must be torn down the same day; guard specs
prove via `audit_log` that read-only runs wrote nothing.

## Architecture (the rules that matter)

- **Stack pins that change how you write code**: Next **16.2** (App Router;
  read `node_modules/next/dist/docs/` before writing route/API code — see
  AGENTS.md), React **19.2**, Tailwind **v4** (CSS-first — there is **no
  `tailwind.config`**; tokens live in `@theme`/`:root` in
  `src/app/globals.css`), Vitest 4, Playwright 1.61. Path alias `@/` → `src/`.
- **Business math lives in exactly two synced places**, both tested against
  `GOLDEN_CASES` in `src/lib/amortization.ts`: SQL `compute_terms()` in
  `supabase/migrations/0001_schema.sql` and TS `computeTerms()`. Change both
  or neither; run `npm test` + `verify-sql-terms.ts`.
- Terms: 25% downpayment; 4/5-mo Good-as-Cash (total = cash price); 6-mo
  total = cash×1.3×0.75 + cash×0.25; 12-mo = cash×1.5×0.75 + cash×0.25.
- **All time-dependent numbers** (months elapsed, expected-to-date, overdue,
  balance, followup tier) come ONLY from the `v_contract_financials` view
  (0002 migration), computed in Asia/Manila. Never recompute in JS.
- **Writes go through SECURITY DEFINER functions** (`create_contract`,
  `record_payment`, `void_payment`, `unvoid_payment`, `close_contract`) —
  never insert contracts/payments directly; IDs
  (YYYY### and PAY####) come from the race-safe `id_counters` table.
- **Roles (5, migration 0011)**: `owner`, `admin` (admin assistant — posts
  payments/receipts, creates contracts), `collector` (assigned worklist, logs
  collections, never posts payments), `sales_agent` (restricted read-only —
  own closed deals + own commission/customers only), `delivery`; `staff` is
  legacy (migrated to `admin`, kept in the CHECK during transition). Enforced
  by RLS in Postgres; SQL helpers `can_post_payments()` (owner/admin),
  `is_collector()`/`is_sales_agent()`/`is_delivery()`, `my_role()`; TS mirror
  in `src/lib/supabase/server.ts` (`Role` union, `canPostPayments`). Nav
  visibility is a per-link `roles[]` allowlist in `nav-links.tsx` — UI hiding
  is convenience only. Payments are never deleted — void/restore.
- **Business modules** (each = a migration + a colocated `src/app/(app)/<x>/`
  page module; all writes via SECURITY DEFINER RPCs + RLS): **collector ops**
  (0012 — assign collectors, `log_collection` → admin `post_collection_entry`,
  cash advances; `/collections` + `/collections/report`); **sales commission**
  (0013 — `v_contract_dp` DP-paid signal, `commissions` = 10% of cash_price
  earned when DP fully paid, `leads`; `/commissions`, `/leads`,
  `/print/commission-statement`); **deliveries + suppliers** (0014 — one
  `deliveries` row per contract via after-insert trigger, supplier cost +
  invoice-lag; the legacy `contracts.delivery_status` text is now a
  trigger-synced label, not edited by hand); **inventory** (0015 — `products`
  + `stock_movements`; stock decrements on in-stock delivery); **cash sales**
  (0016 — `contracts.sale_type='cash'` modelled as `term=0, dp=total,
  monthly=0` so the frozen views need NO change; no-agent sale → `sales_agent
  = 'Office Sales'`); **team tasks** (0017 — `tasks`/`task_comments`, assign to
  a person or a role, comment thread, nav badge); **product catalog** (0018 —
  `products.price` (selling price, pre-fills the new-sale form) +
  `products.description` (0019) + uploaded `product_photos` in the **public
  Supabase Storage bucket `product-photos`**, managed on `/products`). Deploys
  go straight from local via `vercel --prod` (linked project "eandj").
- **Payroll** (0009): semi-monthly payslips (1–15, 16–end) SNAPSHOT all
  amounts at create/refresh/finalize (like contracts) — income = period sum
  of `v_dtr_days.day_pay` + jsonb extra lines; gov contributions (EE/ER on
  `employee_rates`) deducted only on 16–end slips; draft→final (staff RLS
  sees only own final; reopen instead of deleting finals); print page
  `/print/payslip/[id]`. All writes via RPCs (`create_payslip`,
  `finalize_payslip`, …).
- **DTR** (0005–0008, 0010 migrations): staff clock in/out via
  `clock_in`/`clock_out` RPCs (one block/day, Manila time); hours &
  holiday-pay math lives ONLY in SQL (`dtr_hours()`, views
  `v_dtr_days`/`v_dtr_month`) — worked regular holiday ×2.00, special ×1.30,
  unworked regular holiday pays 8h **only on weekdays** (weekend holidays
  unpaid unless worked); PH holidays seeded 2025–2030 in `holidays` (owner
  adds proclaimed ones like Eid/CNY in /dtr/settings); hourly rates in
  `employee_rates` (NOT profiles — staff would see each other's pay). Staff
  can't edit punches — they file correction requests
  (`request_time_correction`) that the owner approves
  (`resolve_time_correction` applies the times) or rejects. **Geofence**
  (0010): punches blocked unless within `radius_m + min(GPS accuracy, 100m)`
  of an active `dtr_locations` row (empty table = geofence OFF — the kill
  switch; owner manages rows in /dtr/settings); `clock_in`/`clock_out` take
  optional `p_lat/p_lng/p_accuracy_m` and store coords on `time_records` for
  audit; client coords are spoofable — it's a deterrent, not proof; field
  work (deliveries) goes through correction requests. Verify with
  `scripts/verify-dtr.ts` (hours, Easter, holidays, `distance_m` goldens).
- 3-tier follow-up messages in `src/lib/messages.ts` (check-in / friendly
  overdue / formal demand at 3+ months since last payment). GCash: Ruel Ryan
  Rosal, 09069029261. Company constants in `COMPANY`.
- **Collections** (0012): collectors work a priority-ordered worklist built
  from `v_contract_collections` (there is no `v_collector_worklist` object —
  the page filters and orders that view) and `log_collection` into
  `collection_entries` —
  which are NOT payments until owner/admin `post_collection_entry` posts them
  via `record_payment`. Cash advances tracked issue→close
  (`cash_advances`/`cash_advance_expenses`). Accountability = daily report
  (`v_collector_day`, `/collections/report`) + the remittance ledger (0030), no
  per-visit GPS. Routes `/collections`, `/collections/report`,
  `/collections/remittances`.
- **Collector remittances** (0030): `remittances` (`RMT####`) is one row per
  hand-over of field cash; `v_collector_remittance.cash_on_hand` = cash
  collected − remitted, per collector. Three deliberate properties: entry
  **status is irrelevant** (pending and posted both count — posting is
  bookkeeping, the cash is in the bag until handed over); **online contributes
  zero** (GCash goes straight to the office — performance, but nothing to
  remit); **a voided payment does not refund custody** (cancel the *entry* if
  the cash never existed). `record_remittance` owner/admin,
  `cancel_remittance` **owner-only**; never deleted. No opening balances were
  seeded — an assumed "settled on paper" row would record a hand-over the app
  never witnessed. `v_collector_month` is the history.
  **`post_collection_entry` and the Contracts tab are the same act** — both
  call `record_payment`, so doing both creates two payments for one collection.
  The house workflow is the Contracts tab, which strands the collector's entry
  as a ghost in the to-post queue; `v_entry_payment_candidates` finds those
  pairs (same contract, exact amount, ±7 days, unvoided, unlinked) and
  `link_collection_payment` closes the entry against the payment that already
  exists, **creating nothing**. Posting a matched entry is still possible but
  the dialog warns in red.
- **Commission & leads** (0013): assign an agent to a contract
  (`set_contract_agent`); a `commissions` row (one/contract, 10% of
  `cash_price` snapshot) goes pending→earned (when downpayment fully paid, per
  the separate `v_contract_dp` view) →paid (`mark_commission_paid`). Lead
  pipeline: agent `submit_lead` → admin converts (`/contracts/new?leadId=`) or
  rejects. Routes `/commissions`, `/leads`,
  `/print/commission-statement/[agentId]`.
- **Deliveries & suppliers** (0014): one `deliveries` row per contract,
  auto-enqueued by an `after insert` trigger on `contracts`
  (pending→in_stock/to_order→ordered→delivered). `suppliers` reference table
  (cost + invoice-lag tracking). Legacy `contracts.delivery_status` text is
  kept as a trigger-derived label (CSV export unchanged) but is no longer the
  source of truth. Route `/deliveries`.
- **Inventory** (0015): `products` (on_hand; all writes RPC-only so
  `stock_movements` ledger stays complete). `mark_delivered` decrements
  on_hand only when the delivery is fulfilled from office stock
  (`in_stock` + linked product); drop-shipped supplier orders never touch
  stock. Product picker on the new-contract form. Stock counts are managed on
  `/products` alongside the catalog (0018 moved them there; `/deliveries` only
  links across).
- **Cash sales** (0016): a cash/outright sale is a `contracts` row with
  `sale_type='cash'`, `term_months=0`, downpayment = total = `cash_price`,
  monthly = 0 — that shape makes the frozen views
  (`v_contract_financials`, `v_contract_dp`, analytics) and the
  delivery-enqueue trigger all correct with NO view changes. Walk-ins with no
  agent are attributed to `sales_agent='Office Sales'`. `isCash` in the UI =
  `term_months === 0`.
- **Team tasks** (0017): `tasks` assignable to a person (`assignee_id`) XOR a
  whole team (`assignee_role`), optionally linked to a contract/customer, with
  a `task_comments` thread. RLS via `can_see_task()`
  (owner/creator/assignee/team-member). Routes `/tasks`, `/tasks/[id]`; nav
  badge counts the caller's open tasks.
- **Two Messenger links** (0020): `customers.messenger_url` is the customer's
  **personal** FB/Messenger; `customers.collection_gc_url` is the **collection
  group chat** (owner + admin + collector + customer), created by the admin
  after the sale. They are different things and were previously collapsed into
  one column by the importer, silently discarding one. Collectors see the group
  chat ONLY; the personal link stays on the contract/customer pages.
  `set_customer_links` (owner/admin) is the write path — `customers` had none.
- **Collection entry fields** (0021): `collection_entries.promised_date` (a
  promise with no date cannot be followed up, and the app used to accept blank
  ones) and `or_no` (the collector's field receipt-booklet number — NOT
  `reference_no`, which is the payer's online ref, and not `payments.receipt_no`,
  which is assigned later at posting). `v_open_promises` floats an account to
  the top of the worklist on the day the customer said they would pay.
  `/collections/sop` is the field manual, reached from the Worklist header.
- **Term repricing** (0022): a 4/5-month Good-as-Cash contract whose term has
  elapsed with a balance outstanding can move to the 6-month, then 12-month,
  schedule. **Two-step and never automatic**: `propose_reprice` drafts an
  amendment (`/print/amendment/[id]`) → the customer signs → `confirm_reprice`
  applies it. `revert_reprice` restores the original price if they settle.
  `cash_price` and `downpayment` NEVER change, which is what keeps commissions
  (10% of `cash_price`, snapshotted) and `v_contract_dp.dp_paid` correct.
  A `before update` trigger now makes the money columns genuinely RPC-only —
  RLS previously granted the owner a blanket column-agnostic UPDATE.
- **Structured addresses + collector GPS** (0023): `ph_locations` holds the
  delivery area (**2,141 barangays, 62 municipalities**, Southern Leyte + Leyte
  + Tacloban City) seeded from the Sheet's "Delivery Locations" tab.
  `customers` gains province/municipality/barangay/street_purok/landmark and
  lat/lng. `customers.address` is KEPT as the address-as-given — the audit
  trail for the backfill and the fallback for anything unparsed; display sites
  prefer the structured form via `formatAddress` (`src/lib/maps.ts`).
  `tag_customer_gps` and `set_customer_landmark` are open to the **collector**
  as well as owner/admin — the only person at the door — but a collector may
  only touch customers on their own worklist. The collector worklist groups by
  municipality → barangay, with a Directions link (`directionsUrl` prefers a
  tagged pin, then the legacy `gps_url`, then an address search).
- **Product typeahead + duplicate review** (0024): `search_products` powers a
  photo typeahead on the new-contract form; items can be added mid-contract
  (`create_product_for_contract` → `review_status = 'pending'` + a task for the
  admin). `/products/review` compares each new item side by side with its
  closest suspects. **Nothing is ever auto-merged.** `merge_products` repoints
  contracts/deliveries/stock_movements/photos, folds in stock, deletes the
  duplicate and logs a task — irreversible.
- **Meal allowance + 13th-month pay** (0026): `employee_rates.
  meal_allowance_per_day` is a supplement paid per day ACTUALLY worked
  (`days_worked` counts real punches, so an unworked holiday earns none) and
  is deliberately its own column so it stays out of the 13th-month base.
  **`payslips.basic_pay` is NOT `dtr_pay`** — 13th month is 1/12 of *basic*
  salary and the law excludes allowances, premiums and holiday pay, while
  `dtr_pay` bakes the holiday multipliers in. Basic is
  `sum(hours_worked * hourly_rate)`; the synthetic unworked-holiday rows carry
  `hours_worked = 0`, so that one expression drops both premium and holiday pay
  with no special-casing. On a test period 40% of `dtr_pay` would have been
  wrongly included. `v_thirteenth_month` + `thirteenth_month_payments` drive
  the owner-only `/payroll/13th-month` report.
- **Contract status signals** (the `collection_status` cleanup, 0027): there are
  now four, and only two are manual. `followup_tier` (auto, money+dates) and
  the new `collection_situation` (auto, derived on `v_contract_financials` from
  `followup_tier` + the latest non-cancelled `collection_entries` row — e.g.
  "Promised to pay Jul 26", "Not reached", "Overdue — no visit logged") are
  never hand-set. `payment_status` (owner closes a contract) and
  `repossession_stage` (owner-only, `set_repossession_stage`: none →
  letter_prepared → letter_sent → for_pullout → repossessed) are the only
  manual ones. The old hand-typed `collection_status` text column, its
  `StatusForm`, `update_contract_status` RPC and `COLLECTION_STATUSES` constant
  are **deleted** — it was redundant, blank on 95% of rows (1,443 of 1,511, per
  the 0027 migration comment), and invisible to collectors. `repossession_stage` is deliberately NOT auto-advanced by the
  demand letter (serving a letter and deciding to pull out are separate calls),
  and taking the item back cancels the sale under the Recto Law.
- **Analytics** (owner-only route `/analytics`): dashboards (monthly sales,
  collections-vs-expected, by-agent, aging, cashflow) built on the financial
  views; Recharts in `charts.tsx`. Consult the dataviz skill before changing.
- Routes: `src/app/(app)/*` is the authenticated shell (auth gate =
  `src/middleware.ts`); mutations are server actions in colocated `actions.ts`
  files. `src/app/print/*` renders print pages (browser print CSS, A4, no
  chrome) outside the app shell.
- CSV exports: `/api/export/[dataset]` (owner-only); keep-alive: `/api/health`.

## Design system

Follow the project skills in `.claude/skills/`:
- `business-management` — credit risk, collections strategy, pricing rules,
  operational policies, and local PH context. Load this skill before
  suggesting any business decision.
- `popular-web-designs` — the token vocabulary ("fintech light", chosen
  2026-07: blue #2563eb primary, ink #111827, `rounded-card` 12px, hairline
  `border-line`, Inter everywhere with `font-semibold` max — no `font-bold`
  in UI — 16px inputs; shared primitives in `src/components/ui.ts`,
  `section-card.tsx`, `stat-tile.tsx`; no emoji in UI).
- `claude-design` — process: surface-first (customer card > collections >
  lists), anti-slop audit before shipping, variants for new designs.
- `sketch` — disposable HTML mockups in scratchpad before big new screens.

Light theme only. Charts use the separate validated palette in `globals.css`
(`--chart-*`, `--status-*`) — consult the dataviz skill before changing.

## Legal watch-outs (PH) — verified against the law, not assumed

These shaped real code. Do not "simplify" them away.

- **Recto Law (Civil Code 1484).** The contract creates **no chattel mortgage**
  — clause 2 is bare retention of title — so only two remedies exist: sue for
  the balance, **or** cancel the sale and take the item. They are alternatives;
  taking the item back bars recovering the balance, and any agreement otherwise
  is void. The demand letter now states a single elected remedy.
  **Unresolved**: past repossessions kept all payments under a contract silent
  on forfeiture. Needs a lawyer.
- **Art. 1308 mutuality.** A price cannot be revised by one party alone, and
  notice does not cure it. That is why repricing is framed as a *conditional
  discount lapsing on an objective event the customer controls*, enforced in
  SQL, and why existing contracts need a signed amendment.
- **Art. 1169**: a demand letter is what puts the customer in default. 15 days
  (`DEMAND_DEADLINE_DAYS`), inside the usual 10–30 range.
- **RA 3765 (Truth in Lending)**: the printed contract discloses amount
  financed, finance charge in pesos, and the simple annual rate.
- **Data Privacy Act**: never disclose a debt to a neighbour or relative. This
  is why the SOP's "nobody home" script says nothing about why the collector is
  there.
- Collection conduct follows SEC MC 18 as the standard: no threats, no
  obscenity, no public shaming, contact only 6 AM–10 PM.

## Gotchas

- **SELECT → check in plpgsql → UPDATE is the house bug.** It reads as correct
  and is not: under READ COMMITTED two callers both pass the check. It caused
  the `post_collection_entry` double-post (two payments for one bag of cash)
  and the same shape was in `cancel_collection_entry`, `mark_commission_paid`
  and `add_advance_expense`. In a money RPC either lock the row
  (`select ... for update`) or put the predicate in the UPDATE
  (`where id = $1 and status = 'pending'` + `if not found then raise`) — 0031
  does both. And when an invariant spans two rows ("one payment, one entry"),
  a pre-check cannot hold it: use a constraint. Also: **EXECUTE is granted to
  `PUBLIC` by default**, so a new SECURITY DEFINER function is callable by
  `anon` unless you `revoke` it or check the caller inside.
- `audit_row_changes()` is `after update` only — **inserts are never audited**,
  on any table. A row that is created and then cancelled leaves one audit
  trail entry (the cancel), not two.
- **Two code paths have never run in prod, so treat them as untested**: there
  are **zero cash sales** (no contract with `term_months = 0`), and as of
  2026-08-05 there were **no pending `collected` collection entries** — the
  to-post queue was empty, and all 34 pending entries were non-collecting visit
  outcomes (14 not_available, 14 promised, 6 refused, ₱0 between them). Only 3
  collected entries exist and all are posted.
- To exercise a guarded RPC against prod without a JWT, wrap it in a
  transaction and impersonate:
  `perform set_config('request.jwt.claims', json_build_object('sub', <uuid>)::text, true)`.
  A `DO` block that ends with `raise exception '%', log` returns the results in
  the error message **and** forces the rollback — that is how 0031/0032 were
  verified against live data without writing any.
- PowerShell 5.1 host: no `&&`; git messages with inner double quotes break —
  use single-quoted here-strings without embedded `"`.
- PostgREST caps reads at 1000 rows — paginate with `.range()` for full scans,
  **and always `.order()` when you do**. Without a stable sort the pages
  overlap and drop rows; this silently produced a phantom ₱32k discrepancy in a
  verification script.
- **The frozen-view trap.** `v_contract_financials` was written as
  `select c.*`, which Postgres expanded to the 19 contracts columns of 0001;
  the table now has 24. Re-declaring it with `c.*` splices five columns into
  the middle and `create or replace` fails with "cannot change name of view
  column". It now enumerates them by hand — keep it that way. Likewise
  `v_contract_collections` is `select f.*` and does **not** inherit new
  columns: it must be DROPPED and recreated, not replaced. Both bit us in 0020
  and again in 0023. After any view change, verify with
  `select <newcol> from v_contract_collections limit 1`.
  **And when you DROP `v_contract_financials` (needed to remove a column, as
  0027 did), FOUR views depend on it, not one:** `v_contract_collections` plus
  the analytics views `v_aging`, `v_dashboard_stats`, `v_top_customers`. Drop
  all four first and recreate all four, or the drop fails with "other objects
  depend on it". Get their live definitions with
  `select pg_get_viewdef('public.v_aging'::regclass, true)` before dropping.
  `v_deliveries` was the third victim: its `d.*` silently lacked `product_id`
  (added 0015) until 0028 drop-and-recreated it with enumerated columns.
  Assume any `select x.*` view has this problem.
- **`create or replace function` with a changed argument list creates an
  OVERLOAD**, and PostgREST `rpc()` then resolves ambiguously. `drop function`
  first (see 0010's comment, and 0021's `log_collection`).
- **Re-import wipes `id_counters`.** It reseeds only contract/payment, so every
  other series restarts at #0001 and collides with surviving rows — after the
  2026-07-20 cutover, adding *any* product or task failed. 0025 repairs all
  counters from the rows present; `import.ts` now reseeds them. Re-run 0025 if
  a future import misbehaves (it is idempotent). **Both lists are hardcoded**,
  so a migration that adds a new `next_counter` series must add it to
  `import.ts` AND ship its own repair block — 0030 does exactly that for
  `remittance`, and re-running 0030 is the remedy for that series.
- **Fuzzy search: use `word_similarity`, not `similarity`.** `similarity()`
  normalises over the whole string, so a short query against a long product
  name barely separates ("sharp tv 32" scored 0.35 vs the right TVs and 0.09 vs
  the wrong fridges). `word_similarity` scored 1.00 vs 0.50. Threshold 0.45 was
  tuned on real data — at 0.15, "fridg" returned Dining Tables.
- **dHash is weak on this catalogue.** Measured across all 8,911 photo pairs:
  closest 2 bits, median 30 — and every closest pair is a *different* product
  (2 bits between two Acer laptops). White-background studio shots have
  near-identical silhouettes. Photo evidence is trusted only at **≤2 bits**
  (the same file re-uploaded); name similarity leads the ranking. Do not
  restore the textbook "≤5 = duplicate".
- **Repricing restates history**: analytics views `sum(total_price)` bucketed
  by `contract_date`, so a reprice changes a past month's reported sales.
  `contract_repricings` preserves the originals, so it is reconstructible.
  Undecided.
- `followup_tier` keys on time since last payment, so an account that has
  **never paid can never reach `demand`**. Review those by hand.
- Supabase free tier pauses after ~7 idle days — `.github/workflows/keepalive.yml`
  pings `https://eandj-chi.vercel.app/api/health` daily.
- `middleware.ts` is deprecated in Next 16 (works; rename to proxy.ts only
  deliberately — it's the auth gate).
- Migration CSVs, reports and DB backups live OUTSIDE the repo in
  `<home>\Documents\eandj-data\` (customer PII — never commit) — on the current
  machine `C:\Users\ACER\Documents\eandj-data\`. `backup-prod.ts` had this
  hardcoded to a `ryan` profile and failed outright on any other machine; it
  now resolves from `os.homedir()`, with `EANDJ_DATA_DIR` to override. That
  folder holds the timestamped `backup-*/` JSON snapshots, the Sheet exports,
  `migration-report.md` and `address-backfill-report.md` (which lists the 109
  customers still needing a barangay chosen by hand).
- **Take a backup before anything destructive.** `npx tsx scripts/backup-prod.ts`
  dumps every table (stable-sorted pagination, row counts verified against the
  server, manifest + auth users) to `eandj-data\backup-*\`. Full dumps have
  already made two risky operations recoverable — the delivery statuses after
  the cutover were restored from one. The `product-photos` bucket is not
  backed up (re-derivable from the pricelist import).
