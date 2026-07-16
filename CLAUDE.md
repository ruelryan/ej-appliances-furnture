@AGENTS.md

# E & J Appliances Furniture — Business App

Installment-sales management app for a small appliance/furniture retailer in
Southern Leyte, PH. Replaces a Google Sheets + Apps Script system (reference
copy of the old script: `C:\Users\ryan\Downloads\eandjappscript.txt`). Owner:
Ryan (ruelryanrosal@gmail.com) — not a professional developer; explain
technical trade-offs plainly and confirm before destructive actions.

## Status (2026-07-16)

- **Deployed to Vercel**: https://eandj-chi.vercel.app — with real data:
  1,509 contracts, 1,126 customers, 5,894 payments (₱24.2M, reconciled to
  the centavo) migrated from the Sheet.
- Supabase project `trjlqcvhrgggcvsxxaml`, region **ap-south-1** (pooler:
  `aws-1-ap-south-1.pooler.supabase.com`). Migrations 0001–0009 applied.
- GitHub: `ruelryan/ej-appliances-furnture` (branch `main`; an older Vite
  prototype is parked on `old-vite-app`).
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
- Roles: `owner` vs `staff`, enforced by RLS in Postgres (UI hiding is
  convenience only). Payments are never deleted — void/restore.
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
