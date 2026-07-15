@AGENTS.md

# E & J Appliances Furniture — Business App

Installment-sales management app for a small appliance/furniture retailer in
Southern Leyte, PH. Replaces a Google Sheets + Apps Script system (reference
copy of the old script: `C:\Users\ryan\Downloads\eandjappscript.txt`). Owner:
Ryan (ruelryanrosal@gmail.com) — not a professional developer; explain
technical trade-offs plainly and confirm before destructive actions.

## Status (2026-07-15)

- **Live locally** with real data: 1,509 contracts, 1,126 customers, 5,894
  payments (₱24.2M, reconciled to the centavo) migrated from the Sheet.
- Supabase project `trjlqcvhrgggcvsxxaml`, region **ap-south-1** (pooler:
  `aws-1-ap-south-1.pooler.supabase.com`). Migrations 0001–0004 applied.
- GitHub: `ruelryan/ej-appliances-furnture` (branch `main`; an older Vite
  prototype is parked on `old-vite-app`).
- **Not yet deployed to Vercel** — that plus final data re-import at cutover
  are the remaining steps (see README "Deploying to Vercel").
- Owner login exists; temp password should be changed if not already.

## Commands

```
npm run dev      # dev server (localhost:3000)
npm test         # Vitest — amortization golden cases + date math
npm run build    # production build; must pass before commit
npx tsx scripts/check-connection.ts       # env/DB sanity check
npx tsx scripts/apply-migrations.ts 0005  # apply a single new migration
npx tsx scripts/verify-sql-terms.ts       # SQL math vs golden fixture
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
- 3-tier follow-up messages in `src/lib/messages.ts` (check-in / friendly
  overdue / formal demand at 3+ months since last payment). GCash: Ruel Ryan
  Rosal, 09069029261. Company constants in `COMPANY`.
- Print pages live under `src/app/print/*` (browser print CSS, A4, no chrome).
- CSV exports: `/api/export/[dataset]` (owner-only); keep-alive: `/api/health`.

## Design system

Follow the project skills in `.claude/skills/`:
- `popular-web-designs` — the token vocabulary (coral #f44d55 primary, navy
  ink, teal secondary, `rounded-card` 14px, Poppins 600 headings via
  `font-display font-semibold` — NEVER `font-bold` on headings, 700 isn't
  loaded — Lato body, 16px inputs).
- `claude-design` — process: surface-first (customer card > collections >
  lists), anti-slop audit before shipping, variants for new designs.
- `sketch` — disposable HTML mockups in scratchpad before big new screens.

Light theme only. Charts use the separate validated palette in `globals.css`
(`--chart-*`, `--status-*`) — consult the dataviz skill before changing.

## Gotchas

- PowerShell 5.1 host: no `&&`; git messages with inner double quotes break —
  use single-quoted here-strings without embedded `"`.
- PostgREST caps reads at 1000 rows — paginate with `.range()` for full scans.
- Supabase free tier pauses after ~7 idle days — `/api/health` + a scheduled
  ping (GitHub Actions) once deployed.
- `middleware.ts` is deprecated in Next 16 (works; rename to proxy.ts only
  deliberately — it's the auth gate).
- Migration CSVs and reports live OUTSIDE the repo in
  `C:\Users\ryan\Documents\eandj-data\` (customer PII — never commit).
