# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

# E & J Appliances Furniture — Business App

Installment-sales management app for a small appliance/furniture retailer in
Southern Leyte, PH. Replaces a Google Sheets + Apps Script system (reference
copy of the old script: `C:\Users\ryan\Downloads\eandjappscript.txt`). Owner:
Ryan (ruelryanrosal@gmail.com) — not a professional developer; explain
technical trade-offs plainly and confirm before destructive actions.

## Status (last reviewed 2026-08-29)

Facts here carry their own date. Trust the per-entry date, not the heading —
this section is the volatile half of the file and drifts fastest.

- **Deployed to Vercel**: https://eandj-chi.vercel.app. **Cutover is done** —
  the Sheet was re-imported on 2026-07-20: 1,511 contracts, 1,127 customers,
  5,901 payments (₱24,256,852.39, reconciled to the centavo). The Sheet is no
  longer the source of truth; anything recorded there now is a divergence.
- **The Sheet kept being used anyway, and was reconciled back in on
  2026-08-20** (`scripts/sync-sheet-divergence.ts`). Prod now holds **1,539
  contracts, 1,149 customers, 6,022 payments**, and **every contract number in
  the app matches the Sheet, in both directions, with nothing missing either
  way**. The script is **idempotent** — it recognises its own earlier work (the
  renumber is done once `2026163` exists; a conflict is skipped once the row
  already reads the corrected value) and re-derives everything from the workbook,
  so re-running it is safe and is the way to fold in the next month's drift.
  What had drifted in one month:
  - **26 sales** (2026160–2026162, 2026164–2026186, every sale from 07-21 to
    08-19) were written only in the Sheet. **₱146,985 of payments** with them.
  - **One number collision.** Only one contract was ever created in the app
    post-cutover, and it took `2026160` — a number the Sheet had already spent.
    That sale is the Sheet's **2026163** (Mate, Clara) and was renumbered.
    Root cause: `id_counters` knows nothing about numbers issued outside it.
  - **Payment numbers diverged permanently from PAY5939.** Both systems minted
    `PAY####` independently, so the same number denotes a different payment in
    each. `payments.payment_no` is unique, so imported payments took **fresh**
    numbers — **app payment numbers no longer match the Sheet's, and the Sheet's
    PAY#### is not a lookup key for anything after PAY5938.** The only reliable
    join is contract + date + amount, which is what the script uses.
  - Two records genuinely disagreed and the Sheet was taken as right (Ryan,
    2026-08-20): PAY5967 re-dated to 07-27, PAY6017 corrected to ₱1,800.
  - Contract **30120** (Nyve, Amilita, 2024-01-31) had **no cash price** in the
    Sheet and was skipped at both the cutover and the first pass of this
    reconciliation. Ryan supplied **₱14,900** on 2026-08-20 and it is now in
    (`PRICE_OVERRIDES` in the script). It is also the one **legacy-numbered**
    import: `create_contract` can only mint `<year of contract_date><3 digits>`,
    so a 5-digit number like `30120` is created, renamed, and that year's counter
    put back — which is why no stray `contract:2024` scope exists.
  - **Still open (judgement, not code)**: **2026172/2026173 look like the same
    sale entered twice** (both ₱29,800 Panasonic, 2026-08-04, "Sanico, Elvira
    Escoro" vs "Escoro, Sanico"); 2026172 is cancelled+closed, which is how the
    Sheet has it. Also **a closed contract reads as "Fully paid" whatever the
    balance** — 2026167 (₱5,679 left) and 2026182 (₱3,900 left) were closed in
    the Sheet and now show that way. That is `v_contract_financials` behaving as
    designed (`payment_status` wins the cascade), not an import artefact.
  - **This will recur** while sales are still written in the Sheet. The script
    is re-runnable and re-derives the diff from the workbook each run, but the
    fix is to stop dual entry, not to keep re-syncing.
- Supabase project `trjlqcvhrgggcvsxxaml`, region **ap-south-1** (pooler:
  `aws-1-ap-south-1.pooler.supabase.com`). Migrations **0001–0032 all applied
  to prod** (0029/0031/0032 applied and verified 2026-08-05, code deployed the
  same day). Catalog: **136 products**, all with photos and perceptual hashes
  (seeded by `scripts/import-pricelist.ts`; 12 duplicates merged out).
- GitHub: `ruelryan/ej-appliances-furnture`. Branch state (2026-08-17):
  **`main` is current and is the branch to work from** — `feat/collector-
  remittances` (0030 plus the whole 0029/0031/0032 security + integrity audit)
  was fast-forwarded into it at **3415c47** and pushed; local and origin agree,
  and prod runs this code. That branch and the empty
  `security/rls-and-rpc-hardening` were **deleted 2026-08-17**. Two branches
  remain, both on purpose:
  - **`redesign/fintech-light`** (remote only) — mostly merged at 4dee47a, but
    it still carries **one unmerged commit, 659d70e "In-app staff manual at
    /help"** (2026-07-21): `src/app/(app)/help/` with a 785-line `topics.tsx`,
    12 role-filtered topics, linked from the top bar. **`/help` is written but
    is NOT in `main` and NOT deployed.** Merge it or drop it deliberately —
    do not delete this branch until then.
  - **`old-vite-app`** (remote only) — the older Vite prototype, parked.
- **Vercel IS connected to GitHub — a push to `main` deploys to production by
  itself.** (Project "eandj", org `melonminds`. Corrected 2026-08-10; a
  2026-08-06 entry here claimed the opposite and was wrong.) A push to any
  other branch builds a Preview. **`vercel project inspect` does not print a
  Git section in CLI 58.x, and `vercel ls` has no branch column — absence of
  evidence there is NOT evidence of absence.** The reliable test is
  `vercel inspect <url>`: a Git-triggered build carries a
  `eandj-git-<branch>-melonminds.vercel.app` alias, a CLI build does not.
  **Consequence that matters: code can reach prod before its migration is
  applied.** Migrations are still manual (`scripts/apply-migrations.ts`), so
  for any commit that needs one, **apply the migration first, then push** — the
  reverse order is what would have broken collection posting in 0031, where new
  code called `unlink_collection_payment` before it existed.
- **Preview deploys cannot reach the database.** All three Supabase env vars
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`) are scoped to **Production only** (verified
  2026-08-10). Previews therefore build green but fail at runtime. That is a
  safety property, not a bug — there is no staging DB, so a preview that DID
  have keys would be a public URL onto live customer data. **Do not add these
  vars to the Preview scope.**
- **Users are now real** — **four** of them (verified in prod 2026-08-06):
  **two owners** — Ruel Ryan Rosal and **Elvira Rosal** (Ryan's mother and a
  co-owner of the business; account added 2026-07-24 as `admin`, promoted to
  `owner` 2026-08-06) — admin Analyn Clemente, collector Roger Dasal. The four
  sample/test accounts were hard-deleted 2026-07-20 (archive:
  `eandj-data/deleted-test-accounts.json`). **Nothing assumes a single owner**:
  `is_owner()` (`0001:42`) matches on `auth.uid()`, and no app code selects
  "the" owner row — keep it that way. Elvira does not clock in (no
  `employee_rates` row, no punches, no payslips); the DTR tab is visible to her
  but demands nothing, and no payslip can be computed without a rate row.
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
  rows — **that backup was incomplete**: `remittances` was missing from
  `backup-prod.ts` from 0030 until it was fixed 2026-08-29, so no dump taken in
  that window holds the remittance ledger). Migrations went in **before** the
  code deploy, not after as originally planned: the new code calls
  `unlink_collection_payment` and passes `p_force`,
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
  assigned**. His employment contract **was signed before he started**
  (confirmed by Ryan 2026-08-06) — Art. 296 is satisfied, no action needed.
  Still open (human, not a commit — verified in prod 2026-08-06): his
  SSS/PhilHealth/Pag-IBIG **amounts are all still zero** in `employee_rates`,
  so his 16–end slips deduct nothing. Ryan is entering the real figures within
  a day or two of 2026-08-06; until then do not finalize a 16–end slip for him.

## Commands

```
npm run dev      # dev server (localhost:3000)
npm start        # serve a production build (after npm run build)
npm test         # Vitest — amortization golden cases + date math
npx vitest run src/lib/__tests__/amortization.test.ts   # one file (-t "name" for one case)
npm run lint     # ESLint
npm run build    # production build; must pass before commit
npx tsx scripts/check-connection.ts       # env/DB sanity check
npx tsx scripts/apply-migrations.ts       # apply ALL migrations in order (fresh DB)
npx tsx scripts/apply-migrations.ts 0005  # apply a single new migration
npx tsx scripts/verify-sql-terms.ts       # SQL math vs golden fixture
npx tsx scripts/verify-dtr.ts             # DTR hours/holiday SQL vs fixtures
npm run e2e:readonly                      # Playwright read-only suite — safe any time
npm run e2e:writes   # Playwright write suite — WRITES TO PROD; full procedure in docs/testing.md
npx playwright test e2e/specs/readonly/auth.spec.ts   # one spec (-g "name" for one test)
npx tsx scripts/e2e/setup-test-users.ts --apply   # create test-*@eandj.test → .env.e2e
npx tsx scripts/e2e/cleanup-test-data.ts          # remove rows the write suite created
npx tsx scripts/e2e/teardown-test-users.ts        # delete the test accounts (same day)
npx tsx scripts/backup-prod.ts            # full JSON dump of all tables → eandj-data\backup-*
npx tsx scripts/migrate/import.ts --dir <csvs> [--load]  # Sheet re-import
npx tsx scripts/sync-sheet-divergence.ts [--apply]  # fold Sheet drift back in
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

**There is a second way, and for anything money-shaped it is the better one**:
connect with `pg` instead (`SUPABASE_DB_PASSWORD`, the connect helper in
`apply-migrations.ts`), open a transaction, and impersonate a real user with
`set_config('request.jwt.claims', json_build_object('sub', <uuid>, 'role',
'authenticated')::text, true)`. Every guarded RPC then works exactly as it does
in the browser, so `compute_terms`, `id_counters`, the delivery trigger and the
0032 payment caps all still hold — you are not reimplementing them by hand and
getting them subtly wrong. `set_config(..., true)` is transaction-local, so the
impersonation and the calls must share one transaction. `sync-sheet-divergence.ts`
does this, and gets a genuine dry run out of it for free: run the whole thing and
`rollback` instead of `commit`.

`.env.local` (gitignored) holds Supabase URL/keys and `SUPABASE_DB_PASSWORD`
(quote it — it contains `#`).

## Docs

`docs/` is the developer reference: `architecture.md`, `database.md` (full RPC
catalog), `roles-and-permissions.md`, `business-rules-legal.md`, `testing.md`,
`operations.md`, plus five per-module pages in `docs/modules/`
(`collections`, `commissions-leads`, `contracts-payments`,
`deliveries-inventory-products`, `payroll-dtr`). **Standing rule: any commit
that changes user-facing behavior, a route, a role's access, a business rule,
or the schema updates the matching `docs/` page in the same commit.** On
drift, the code is the truth — fix the doc.

`README.md` is the *setup* doc (new machine, fresh Supabase project, Sheet
import, Vercel) — not a second architecture reference. The standing rule above
does not cover it, which is how it rotted once already; if a commit changes
setup steps or the feature list, fix README too.

**`/help`, the in-app staff manual, is written but unmerged** — see the branch
note under Status. `docs/README.md` used to describe it as *shipped*, sending a
reader to a route that does not exist in `main`; corrected 2026-08-29 to say it
is written but unmerged. When `/help` is merged or dropped, fix that line too.

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
- **Business modules follow one shape**: a migration + a colocated
  `src/app/(app)/<x>/` page module (mutations in an `actions.ts` beside the
  page) + writes only via SECURITY DEFINER RPCs guarded by RLS. Each module has
  its own bullet below and a page in `docs/modules/`.
- **Four Supabase modules in `src/lib/supabase/` — picking the wrong one is a
  security bug, not a style choice**: `client.ts` (browser, anon key),
  `server.ts` (RSC + server actions, cookie session; also home of the `Role`
  union, `canPostPayments` and the role helpers), `admin.ts` (service-role key
  — **bypasses RLS entirely**; scripts and a small number of admin server
  actions only, never anything reachable from a user request without its own
  role check), and `filters.ts` (escapes user input for the three `.or()`
  searches — PostgREST filter syntax is injectable otherwise). Anything the
  browser touches gets the anon key and lets RLS do the work.
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
- **Product catalog** (0018–0019): `products.price` is the selling price and
  pre-fills the new-sale form; `products.description` (0019) is free text.
  Photos are uploaded to the **public Supabase Storage bucket
  `product-photos`** and tracked in `product_photos`. Managed on `/products`,
  which is also where stock counts live.
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
- **`/admin`** (owner-only) is user administration — `createUser` (which must
  set `active: true`, see 0029), the role select and the active/inactive
  toggle, plus the audit log and the CSV export links. **`/account`** is the
  one page every role gets: change your own password. Neither is a business
  module and neither has a migration of its own.
- CSV exports: `/api/export/[dataset]` (owner-only) — exactly four datasets:
  `contracts` (from `v_contract_financials`), `payments`, `aging`,
  `customers`. Keep-alive: `/api/health`.

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
- **`pg` returns `date` columns as JS `Date`, not `'YYYY-MM-DD'`** — built in the
  machine's local zone, so it both shifts the day and silently loses every string
  comparison against a CSV/Sheet date. In `sync-sheet-divergence.ts` this made
  the reconciliation believe all 6,009 payments were missing. Any script that
  compares dates through `pg` wants
  `pg.types.setTypeParser(1082, (v) => v)` first. `@supabase/supabase-js` goes
  through PostgREST/JSON and does **not** have this problem — only `pg` does.
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
  **Its table list is hand-maintained and the row-count check cannot catch an
  omission** — the manifest verifies the tables it dumped, so a table missing
  from `TABLES` is missing from the verification too. That is how `remittances`
  (0030) went unbacked-up until 2026-08-29. **A migration that adds a table adds
  it to `backup-prod.ts` in the same commit** — the same hardcoded-list trap as
  `id_counters` above, and it has now bitten twice.
