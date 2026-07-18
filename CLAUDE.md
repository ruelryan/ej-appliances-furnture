@AGENTS.md

# E & J Appliances Furniture — Business App

Installment-sales management app for a small appliance/furniture retailer in
Southern Leyte, PH. Replaces a Google Sheets + Apps Script system (reference
copy of the old script: `C:\Users\ryan\Downloads\eandjappscript.txt`). Owner:
Ryan (ruelryanrosal@gmail.com) — not a professional developer; explain
technical trade-offs plainly and confirm before destructive actions.

## Status (2026-07-18)

- **Deployed to Vercel**: https://eandj-chi.vercel.app — with real data:
  1,509 contracts, 1,126 customers, 5,894 payments (₱24.2M, reconciled to
  the centavo) migrated from the Sheet.
- Supabase project `trjlqcvhrgggcvsxxaml`, region **ap-south-1** (pooler:
  `aws-1-ap-south-1.pooler.supabase.com`). Migrations **0001–0019 applied to
  prod**. Product catalog seeded from the Sheet Pricelist tab: **146 products
  with photos** (`scripts/import-pricelist.ts`, pulls Drive images).
- GitHub: `ruelryan/ej-appliances-furnture` (branch `main`; an older Vite
  prototype is parked on `old-vite-app`). Active work is on branch
  **`redesign/fintech-light`**, which deploys straight from local via the
  Vercel CLI (linked project "eandj"); not everything on it is committed to
  `main` yet.
- The original brief is **feature-complete**: 5 roles, collector ops, sales
  commission, deliveries/inventory, cash sales, team tasks, and a product
  catalog (photos + selling price) — migrations 0011–0018, Phases 0–6.
  Current focus is the "fintech light" redesign.
- Remaining: final data re-import from the Sheet at cutover (see README
  "Migrating the Google Sheets data").
- Owner login exists; temp password should be changed if not already.

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
npx tsx scripts/migrate/import.ts --dir <csvs> [--load]  # Sheet re-import
```

`.env.local` (gitignored) holds Supabase URL/keys and `SUPABASE_DB_PASSWORD`
(quote it — it contains `#`).

## Architecture (the rules that matter)

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
  `record_payment`, `void_payment`, `unvoid_payment`,
  `update_contract_status`) — never insert contracts/payments directly; IDs
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
- **Collections** (0012): collectors work a priority-ordered
  `v_collector_worklist` and `log_collection` into `collection_entries` —
  which are NOT payments until owner/admin `post_collection_entry` posts them
  via `record_payment`. Cash advances tracked issue→close
  (`cash_advances`/`cash_advance_expenses`). Accountability = daily report
  (`v_collector_day`, `/collections/report`) + remittance reconcile, no
  per-visit GPS. Routes `/collections`, `/collections/report`.
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
  stock. Product picker on the new-contract form. Managed under `/deliveries`.
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

## Gotchas

- PowerShell 5.1 host: no `&&`; git messages with inner double quotes break —
  use single-quoted here-strings without embedded `"`.
- PostgREST caps reads at 1000 rows — paginate with `.range()` for full scans.
- Supabase free tier pauses after ~7 idle days — `.github/workflows/keepalive.yml`
  pings `https://eandj-chi.vercel.app/api/health` daily.
- `middleware.ts` is deprecated in Next 16 (works; rename to proxy.ts only
  deliberately — it's the auth gate).
- Migration CSVs and reports live OUTSIDE the repo in
  `C:\Users\ryan\Documents\eandj-data\` (customer PII — never commit).
