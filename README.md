# E & J Appliances Furniture — Business App

Web application for managing installment contracts, payments, collections, and
analytics for E & J Appliances Furniture. Replaces the Google Sheets + Apps
Script system.

**Stack:** Next.js (App Router, TypeScript) · Supabase (Postgres + Auth) ·
Tailwind CSS · Recharts · Vercel

## Features

- **Contracts** — create with live amortization preview (25% DP; 4/5-month
  Good-as-Cash; 6-month +30%; 12-month +50%), search, owner-only edits with a
  full audit trail
- **Payments** — quick mobile entry, printable receipts, owner-only void
  (never delete)
- **Customer cards** — balances, expected-vs-paid, payment history, notes
- **Collections** — overdue worklist, 3-tier follow-up messages
  (check-in / friendly reminder / formal demand letter) with copy-to-clipboard,
  Messenger and map links, printable demand letters
- **Analytics** (owner) — sales, collections vs expected, aging receivables,
  cash flow, top customers
- **Admin** (owner) — user accounts, audit log, CSV exports
- **Roles** — owner (everything) vs staff (record payments, update statuses);
  enforced by Postgres Row Level Security, not just the UI

---

## First-time setup

### 1. Create the Supabase project

1. Sign up / log in at [supabase.com](https://supabase.com) (free tier).
2. **New project** → name it `eandj`, pick the Singapore region (closest to
   PH), set a strong database password (save it somewhere safe).
3. When it finishes, go to **Project Settings → API** and copy:
   - Project URL
   - `anon` public key
   - `service_role` secret key

### 2. Configure environment

```
copy .env.example .env.local
```

Fill in the three values from step 1. **Never commit `.env.local`.**

### 3. Apply the database migrations

In the Supabase dashboard → **SQL Editor**, paste and run, in order:

1. `supabase/migrations/0001_schema.sql`
2. `supabase/migrations/0002_views.sql`

Then verify the business math matches the app:

```
npx tsx scripts/verify-sql-terms.ts
```

All golden cases must print ✅.

### 4. Create the owner account

Supabase dashboard → **Authentication → Users → Add user** → enter your email
+ password (check "Auto Confirm User"). Then in **SQL Editor**:

```sql
update public.profiles set role = 'owner', full_name = 'Your Name'
where id = (select id from auth.users where email = 'you@example.com');
```

### 5. Run locally

```
npm install
npm run dev
```

Open http://localhost:3000 and sign in. Staff accounts are created later from
the **Admin** page.

---

## Migrating the Google Sheets data

1. In the Google Sheet, export each tab via **File → Download → CSV**:
   - Contracts Database → save as `contracts.csv`
   - Payments Database → save as `payments.csv`
   - Collection → save as `collection.csv` (optional)

   Put them in a folder **outside this repo** (they contain customer data),
   e.g. `C:\Users\ryan\Documents\eandj-data\`.

2. **Dry run** — parses, cleans, and reports without touching the database:

   ```
   npx tsx scripts/migrate/import.ts --dir C:\Users\ryan\Documents\eandj-data
   ```

   Read `migration-report.md` in that folder. Check:
   - contract/payment counts and peso totals match the Sheet
   - the "possible duplicate customers" list (fix names in the CSVs if needed)
   - all listed issues

3. **Load** — wipes business tables and imports (safe to rerun on a fresh
   export):

   ```
   npx tsx scripts/migrate/import.ts --dir C:\Users\ryan\Documents\eandj-data --load
   ```

   The script reconciles counts and totals at the end and fails loudly on any
   mismatch.

4. Spot-check 10–15 contracts in the app against the Sheet (balance, past
   due, payment history) before trusting it.

---

## Deploying to Vercel

1. Push this repo to GitHub (private repository).
2. [vercel.com](https://vercel.com) → **Add New Project** → import the repo.
3. Add the three environment variables from `.env.local` under
   **Settings → Environment Variables**.
4. Deploy. The app is now live at `https://<project>.vercel.app`, usable from
   any phone.

### Keep-alive (important on the free tier)

Supabase pauses free projects after ~7 days without traffic. Daily use
prevents this, but as insurance create `.github/workflows/keepalive.yml`:

```yaml
name: keepalive
on:
  schedule:
    - cron: "0 22 * * *"   # daily, 6am PH time
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - run: curl -s https://YOUR-APP.vercel.app/api/health
```

---

## Development

```
npm run dev        # local dev server
npm test           # unit tests (amortization golden cases, date math)
npm run build      # production build
```

Business math lives in **two places that must stay in sync**, both tested
against the same golden fixture (`GOLDEN_CASES` in `src/lib/amortization.ts`):

- `compute_terms()` in `supabase/migrations/0001_schema.sql`
- `computeTerms()` in `src/lib/amortization.ts`

All time-dependent numbers (balance, overdue, follow-up tier) come from the
`v_contract_financials` SQL view — never recompute them in the app.

## Weekly backup habit

Admin → Data exports → download all four CSVs and keep them somewhere safe
(Google Drive is fine). Supabase also keeps daily backups, but an offline copy
costs nothing.
