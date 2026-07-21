# Architecture

E & J is a Next.js 16 App Router application backed by Supabase Postgres, deployed on Vercel at https://eandj-chi.vercel.app. The design center is simple: the database is the application. Business math, time-dependent numbers, IDs, and authorization all live in SQL (see [database.md](database.md)); the Next.js layer renders server components, collects form input, and calls `SECURITY DEFINER` RPCs through server actions. There is no separate API server, no client-side state library, and almost no client-side computation of money. This document covers the stack and repo layout, the auth flow, the write path, the two-places rule for business math, and how the app deploys.

## Stack and repo layout

- **Next.js 16 (App Router)** — note `AGENTS.md`: this version has breaking changes vs. training data; read `node_modules/next/dist/docs/` before writing framework code.
- **Supabase** — Postgres + Auth + Storage (public `product-photos` bucket), project `trjlqcvhrgggcvsxxaml` in ap-south-1. `@supabase/ssr` for cookie-based sessions.
- **Tailwind CSS** with the "fintech light" token set; **Recharts** for the analytics charts; **Vitest** for tests (see [testing.md](testing.md)).

```
src/
  middleware.ts            the auth gate (every route except /login and /api/health)
  app/
    (app)/                 authenticated shell: layout.tsx (top bar, sidebar, mobile tabs), nav-links.tsx
      page.tsx             dashboard (redirects sales_agent -> /commissions, delivery -> /deliveries)
      contracts/ customers/ payments/ collections/ commissions/ leads/
      deliveries/ products/ tasks/ dtr/ payroll/ analytics/ admin/ account/
        page.tsx           server component; reads via the Supabase server client
        actions.ts         colocated server actions ("use server") — every mutation for that module
    print/                 print pages (A4 browser-print CSS, no app chrome, own layout):
                           contract, receipt, customer-card, demand-letter, dtr, payslip,
                           commission-statement, amendment
    api/
      export/[dataset]/    owner-only CSV exports
      health/              keepalive endpoint (public)
  lib/
    amortization.ts        computeTerms + GOLDEN_CASES (the TS half of the business math)
    supabase/server.ts     createClient (SSR cookies), Role type, canPostPayments, getProfile
    supabase/admin.ts      service-role client (server-only; used by /admin user management)
    messages.ts, maps.ts, format.ts, locations.ts, image.ts, product-photo.ts
  components/              shared primitives: ui.ts, section-card.tsx, stat-tile.tsx,
                           tier-badge.tsx, address-fields.tsx, ...
supabase/migrations/       0001–0027, the schema's source of truth
scripts/                   one-off data scripts (dry-run by default, --apply to write)
```

Each business module is one migration plus one colocated page module — e.g. collections is migration 0012 (+0021) plus `src/app/(app)/collections/`. Per-module detail lives in [modules/](modules/).

## Auth flow

1. **`src/middleware.ts` is the gate.** It runs on every request except static assets, refreshes the Supabase session cookies, and redirects: no user and not `/login` or `/api/health` → `/login`; signed-in user hitting `/login` → `/`. Note: Next 16 deprecates the "middleware" convention in favor of "proxy" — it still works, and renaming to `proxy.ts` is a deliberate-only change precisely because this file is the auth gate.
2. **Sessions are Supabase SSR cookies.** `createClient()` in `src/lib/supabase/server.ts` wires `@supabase/ssr` to `next/headers` cookies; server components read data with the caller's own JWT, so RLS applies to every query the app makes.
3. **`getProfile()`** fetches the caller's `profiles` row and returns null unless the row exists and `active` is true — a deactivated user is locked out even with a live session.
4. **There is no signup.** The only way an account exists is the owner creating it on `/admin` (a server action using the service-role client; the `handle_new_user` trigger creates the profile row, then the action sets the role). Password changes happen on `/account` with current-password re-verification. See [roles-and-permissions.md](roles-and-permissions.md).

## The write path

Every mutation follows the same three hops:

```
form/button → server action (actions.ts) → supabase.rpc('some_security_definer_fn', ...) → RLS-scoped tables
```

Direct table writes from the app are forbidden — and mostly impossible, because the tables have no INSERT/UPDATE policies. The reasons are concrete:

- **Authorization lives in one place.** Each RPC checks the SQL role helpers (`can_post_payments()`, `is_collector()`, ...) itself, so no code path can forget a guard.
- **IDs are race-safe.** Business numbers (`YYYY###` contract numbers, `PAY####`, `CE####`, ...) come from `next_counter()` on the `id_counters` table — an upsert-then-increment that two concurrent requests cannot duplicate. The app never fabricates an ID.
- **Invariants get enforced, not documented.** `record_payment` is the only way a payment exists; payments are voided, never deleted; `log_collection` refuses a cash entry without a booklet receipt number; since 0022 a trigger physically rejects any change to a contract's money columns outside `confirm_reprice`/`revert_reprice`.
- **Side effects stay atomic.** `create_contract` snapshots terms, writes the note, and creates the commission in one transaction; the delivery row is enqueued by trigger.

The one caveat: one-off scripts (`scripts/`) authenticate with the **service-role key**, which bypasses RLS but has no `auth.uid()` — so an RPC guarded by a role helper will always refuse a script. Scripts therefore write tables directly, following the house pattern (dry run by default, `--apply` to write). See [operations.md](operations.md).

## Business math: exactly two synced places

Term computation exists twice, and only twice, tested against the same fixture:

- **TS:** `computeTerms()` in `src/lib/amortization.ts` — used for the live preview on the new-contract form.
- **SQL:** `compute_terms()` in `supabase/migrations/0001_schema.sql` — used by `create_contract` to snapshot the real values.

Both are asserted against `GOLDEN_CASES` (in `amortization.ts`): `npm test` covers the TS side, `npx tsx scripts/verify-sql-terms.ts` covers the SQL side. **Change both or neither**, and run both checks.

The formulas (downpayment is always 25% of cash price):

| Term | Total price |
|---|---|
| 4 or 5 months ("Good as Cash") | `cash_price` (no markup — the reward for fast payment) |
| 6 months | `cash × 1.3 × 0.75 + cash × 0.25` |
| 12 months | `cash × 1.5 × 0.75 + cash × 0.25` |
| Monthly amortization | `(total − downpayment) / term`, rounded to 2 places |

**Cash sales** (0016) are not a special case anywhere downstream: a cash sale is a contract with `sale_type='cash'`, `term_months=0`, `downpayment = total_price = cash_price`, `monthly = 0`. That shape makes `v_contract_financials`, `v_contract_dp`, the analytics views and the delivery-enqueue trigger all correct with no view changes. In the UI, `isCash` is simply `term_months === 0`.

A contract's money columns are **snapshots** — computed once at creation and never recomputed, so a later formula change never rewrites history. The only sanctioned change is term repricing (0022): two-step (propose → customer signs → confirm), enforced in SQL, and `cash_price`/`downpayment` never move (see [business-rules-legal.md](business-rules-legal.md) for why).

## Time-dependent numbers: one source

All numbers that depend on "today" — months elapsed, expected-to-date, overdue amount, remaining balance, months since last payment, `followup_tier`, and the derived `collection_situation` — come **only** from the `v_contract_financials` view (and views built on it), computed server-side in Asia/Manila via `ph_today()`. Never recompute these in JS: a client's clock, timezone, or a subtly different rounding rule would disagree with the database, and two screens would show two truths. The same rule holds for DTR hours (`dtr_hours()` in SQL has no TS twin) and payslip totals (snapshotted by `payslip_recompute`). The view has a fragile redefinition procedure — read the frozen-view rules in [database.md](database.md) before touching it.

## Design system

The visual language is "fintech light", chosen July 2026 and encoded in the project skills (`.claude/skills/popular-web-designs`, `claude-design`, `sketch` — consult them before designing anything):

- Blue `#2563eb` primary, ink `#111827`, hairline `border-line`, 12px `rounded-card`, Inter everywhere with `font-semibold` as the maximum weight (no `font-bold` in UI), 16px inputs, no emoji in UI.
- Shared primitives in `src/components/ui.ts` (class-string constants like `btnPrimary`, `input`, `theadRow`), `section-card.tsx`, `stat-tile.tsx`.
- **Light theme only.**
- Charts use a separate validated palette in `globals.css` (`--chart-*`, `--status-*`); consult the dataviz skill before changing chart colors or adding a chart.

## Deploys and operations

- **Deploys go straight from local**: `vercel --prod` on the `redesign/fintech-light` branch (linked Vercel project "eandj"). **`main` lags behind** — merge deliberately, not habitually.
- `npm run build` must pass before commit; `npm test` and `npm run lint` are the other pre-flight checks.
- Supabase's free tier pauses after ~7 idle days, so `.github/workflows/keepalive.yml` pings `https://eandj-chi.vercel.app/api/health` daily.
- Migrations are applied with `npx tsx scripts/apply-migrations.ts <number>`; environment sanity via `scripts/check-connection.ts`. Backups, imports, and the rest of the operational playbook are in [operations.md](operations.md).
