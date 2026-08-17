# E & J Appliances Furniture — Business App

Installment-sales management for E & J Appliances Furniture (Southern Leyte,
PH): contracts, payments, field collections, deliveries, inventory, payroll and
analytics. It replaced the Google Sheets + Apps Script system at the
**2026-07-20 cutover** — 1,511 contracts, 1,127 customers and 5,901 payments
were imported and reconciled to the centavo. **The Sheet is no longer the
source of truth**; anything recorded there now is a divergence.

**Live:** https://eandj-chi.vercel.app

**Stack:** Next.js 16 (App Router, TypeScript) · Supabase (Postgres + Auth +
Storage) · Tailwind v4 · Recharts · Vercel · Vitest + Playwright

This file covers **setup and operations**. For how the code is organised and
why, read `CLAUDE.md` and then `docs/` (architecture, database + RPC catalog,
roles, business/legal rules, testing, operations, and five per-module pages in
`docs/modules/`).

---

## Features

- **Contracts** — live amortization preview (25% DP; 4/5-month Good-as-Cash;
  6-month +30%; 12-month +50%), product typeahead, printable contract,
  owner-only edits with a full audit trail. Cash/outright sales too.
- **Payments** — quick mobile entry, printable receipts, owner-only
  void/restore (payments are never deleted), overpayment caps.
- **Customer cards** — balances, expected-vs-paid, payment history, structured
  addresses, GPS pins, notes.
- **Collections** — a priority-ordered collector worklist grouped by
  municipality → barangay, visit logging, promises-to-pay, cash advances, a
  daily accountability report, and a remittance ledger for field cash.
  3-tier follow-up messages (check-in / friendly reminder / formal demand
  letter) with copy-to-clipboard, Messenger links and printable demand letters.
- **Deliveries & suppliers** — one delivery per contract, supplier cost and
  invoice-lag tracking.
- **Inventory & catalog** — products with photos and selling prices, a stock
  ledger, and a duplicate-review queue.
- **Sales commission & leads** — 10% of cash price, pending → earned → paid,
  plus an agent lead pipeline and printable statements.
- **Payroll & DTR** — geofenced clock in/out, PH holiday pay rules, time
  correction requests, semi-monthly payslips, 13th-month report.
- **Team tasks** — assign to a person or a whole role, with a comment thread.
- **Analytics** (owner) — sales, collections vs expected, aging receivables,
  cash flow, top customers.
- **Admin** (owner) — user accounts, audit log, CSV exports.
- **Roles** — five: `owner`, `admin` (admin assistant), `collector`,
  `sales_agent`, `delivery`. Enforced by Postgres Row Level Security and
  SECURITY DEFINER functions, not just by hiding things in the UI.

---

## Running it locally

You need the existing `.env.local` (it is gitignored and never committed —
copy it from another trusted machine or rebuild it from the Supabase
dashboard). It holds:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_PASSWORD=     # quote it — it contains a #
```

```
npm install
npm run dev          # http://localhost:3000
```

This talks to the **live production database**. There is no staging Supabase
project, so a careless local click is a real edit to real customer data.

```
npm test             # Vitest — amortization golden cases + date math
npm run lint
npm run build        # must pass before you commit
npx tsx scripts/check-connection.ts    # env/DB sanity check
```

### Applying a migration

Migrations are **not** applied automatically by the deploy. Apply them by hand:

```
npx tsx scripts/apply-migrations.ts 0033   # one migration
npx tsx scripts/apply-migrations.ts        # all, in order (fresh DB only)
```

**A push to `main` deploys to production on its own**, so for any commit that
needs a migration, **apply the migration first, then push.** The reverse order
ships code that calls a function the database does not have yet.

---

## Deployment

Vercel project **eandj** (org `melonminds`) is connected to GitHub:

- push to **`main`** → production deploy, automatically
- push to any other branch → a Preview build

**Preview deploys cannot reach the database.** All three Supabase env vars are
scoped to Production only, so previews build green and fail at runtime. That is
deliberate: with no staging database, a preview holding real keys would be a
public URL onto live customer data. **Do not add those vars to the Preview
scope.**

`vercel project inspect` does not print a Git section in CLI 58.x. To tell a
Git-triggered build from a CLI one, use `vercel inspect <url>` — a Git build
carries an `eandj-git-<branch>-melonminds.vercel.app` alias.

### Keep-alive

Supabase free projects pause after ~7 idle days. `.github/workflows/keepalive.yml`
curls `https://eandj-chi.vercel.app/api/health` daily at 6am PH time. If the
app URL changes, update it in that file.

---

## Testing

`npm test` is unit tests and is always safe.

The Playwright suite runs **against production** — there is no staging
database.

```
npm run e2e:readonly    # safe any time
npm run e2e:writes      # WRITES TO PROD — follow docs/testing.md exactly
```

Never run the bare `npm run e2e` (it runs both), never run either in CI, and
never point them at the Vercel URL. In `playwright.config.ts`, `workers: 1` and
`retries: 0` are load-bearing — a retry would double-write. The write suite has
a strict backup → create test users → run → clean up data → delete test users
procedure, and the test accounts must be torn down the same day.

---

## Backups

**Before anything destructive, take a full backup:**

```
npx tsx scripts/backup-prod.ts
```

It dumps every table plus auth users and a manifest to
`<home>\Documents\eandj-data\backup-<timestamp>\`, verifying row counts against
the server. Set `EANDJ_DATA_DIR` to write somewhere else. Full dumps have
already made two risky operations recoverable.

That same `eandj-data\` folder — **outside the repo, because it holds customer
PII, and never committed** — is also where the Sheet exports and migration
reports live.

The `product-photos` Storage bucket is not backed up; it is re-derivable from
the pricelist import.

Lighter habit: Admin → Data exports → download all four CSVs (contracts,
payments, aging, customers) and keep them somewhere safe. Supabase also keeps
its own daily backups.

---

## Re-importing from the Sheet

Only relevant for a rebuild or a fresh environment — the cutover is done and
re-importing **wipes the business tables**.

1. Export the tabs to CSV (`contracts.csv`, `payments.csv`, and optionally
   `collection.csv`) into `eandj-data\`, outside the repo.
2. Dry run — parses, cleans and reports without writing:
   ```
   npx tsx scripts/migrate/import.ts --dir <path-to-eandj-data>
   ```
   Read `migration-report.md`: check counts and peso totals against the Sheet,
   review the possible-duplicate-customers list, and read every listed issue.
3. Load:
   ```
   npx tsx scripts/migrate/import.ts --dir <path-to-eandj-data> --load
   ```
   It reconciles counts and totals at the end and fails loudly on a mismatch.
4. Spot-check 10–15 contracts in the app against the Sheet before trusting it.
5. Re-run `npx tsx scripts/apply-migrations.ts 0025` — an import resets
   `id_counters`, and every series other than contract/payment would otherwise
   restart at #0001 and collide with surviving rows. 0025 is idempotent.

One-off data scripts follow a house pattern: **dry run by default, `--apply` to
write**, printing a report before touching anything. They use the service-role
key, which **bypasses RLS**.

---

## Standing from a bare Supabase project

Only for a genuine rebuild.

1. Create the project. Production runs in **ap-south-1**
   (`aws-1-ap-south-1.pooler.supabase.com`). Save the database password.
2. Copy the URL, `anon` key and `service_role` key from **Project Settings →
   API** into `.env.local`, and add `SUPABASE_DB_PASSWORD`.
3. `npx tsx scripts/apply-migrations.ts` — all migrations in order.
4. `npx tsx scripts/verify-sql-terms.ts` and `npx tsx scripts/verify-dtr.ts` —
   every golden case must pass.
5. Bootstrap the first owner (there is no signup page):
   ```
   npx tsx scripts/create-owner.ts you@example.com "Your Name" [password]
   ```
   It prints a random temporary password if you omit one. Every other account
   is created from the in-app **Admin** page.
6. Seed reference data as needed: `import-locations.ts` (barangays and
   municipalities), `import-pricelist.ts` (catalog + photos + perceptual
   hashes).

---

## The one rule that will bite you

Business math lives in **two places that must stay in sync**, both tested
against the same golden fixture (`GOLDEN_CASES` in `src/lib/amortization.ts`):

- `compute_terms()` in `supabase/migrations/0001_schema.sql`
- `computeTerms()` in `src/lib/amortization.ts`

Change both or neither, then run `npm test` and
`npx tsx scripts/verify-sql-terms.ts`.

And every time-dependent number — months elapsed, expected-to-date, overdue,
balance, follow-up tier — comes only from the `v_contract_financials` view,
computed in Asia/Manila. Never recompute it in JavaScript.
