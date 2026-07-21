# Operations — deploy, backup, migrations, imports

Day-to-day operational procedures. The app is deployed on Vercel and backed by a single Supabase project — **there is no staging environment**; production is the only database. That fact drives most of the caution below.

## Environments

| Thing | Value |
|---|---|
| Production URL | https://eandj-chi.vercel.app |
| Supabase project | `trjlqcvhrgggcvsxxaml`, region ap-south-1 (pooler `aws-1-ap-south-1.pooler.supabase.com`) |
| GitHub | `ruelryan/ej-appliances-furnture`; active branch `redesign/fintech-light`, `main` lags — merge deliberately |
| Local dev | `npm run dev` on localhost:3000 — **points at the production database** |

`.env.local` (gitignored) holds `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_DB_PASSWORD` (quote it — it contains `#`). Sanity-check with `npx tsx scripts/check-connection.ts`.

## Deploying

Deploys go straight from the local checkout: `vercel --prod` (linked project "eandj"). `npm run build` must pass before deploying. There is no CI deploy pipeline.

## Backups

**Take a backup before anything destructive.** Full JSON dumps have already made two risky operations recoverable.

```
npx tsx scripts/backup-prod.ts
```

- Dumps **all 28 tables** plus the auth user list to `C:\Users\ryan\Documents\eandj-data\backup-<date>\`, one JSON file per table, with a `manifest.json` of row counts verified against server-side exact counts (the script fails loudly on any mismatch).
- Reads are paginated past PostgREST's 1000-row cap with a stable `.order()` — never remove that (unordered pagination silently drops rows).
- The `product-photos` Storage bucket is **not** included — photos are re-derivable from the pricelist import.
- **When a new table is added in a migration, add it to the script's `TABLES` list in the same commit.**
- The `eandj-data` folder is outside the repo because the dumps contain customer PII. Never commit anything from it.

The owner also keeps the weekly CSV-export habit (`/api/export/*`) as a second, human-readable layer.

## Migrations

Migration files live in `supabase/migrations/`, numbered `0001`–`0027` (all applied to prod). Apply a single new one with:

```
npx tsx scripts/apply-migrations.ts 0028
```

Before writing a migration, read the gotchas in CLAUDE.md — the most dangerous are:

- **The frozen-view trap**: `v_contract_financials` enumerates its columns by hand (never `c.*`); `v_contract_collections` must be DROPPED and recreated, never replaced; dropping `v_contract_financials` requires dropping its four dependents (`v_contract_collections`, `v_aging`, `v_dashboard_stats`, `v_top_customers`) first and recreating all of them.
- `create or replace function` with a changed argument list creates an **overload** and PostgREST `rpc()` becomes ambiguous — `drop function` first.
- Verify math changes with `npx tsx scripts/verify-sql-terms.ts` and `npx tsx scripts/verify-dtr.ts`.

## Data imports

- `npx tsx scripts/migrate/import.ts --dir <csvs> [--load]` — re-import from Sheet CSVs (the 2026-07-20 cutover). **A re-import wipes `id_counters`** and the importer now reseeds them; if a future import misbehaves, re-run migration 0025 (idempotent).
- `npx tsx scripts/extract-tabs.ts`, `import-locations.ts`, `backfill-addresses.ts`, `backfill-photo-hashes.ts`, `import-pricelist.ts` — see each script's header.
- House pattern for all one-off data scripts: **dry-run by default, `--apply` to write**, report printed first, service-role key (bypasses RLS — scripts cannot call RPCs guarded by `can_post_payments()` because those read `auth.uid()`).

## Keep-alive

Supabase's free tier pauses after ~7 idle days. `.github/workflows/keepalive.yml` pings `https://eandj-chi.vercel.app/api/health` daily to prevent that. Don't delete the workflow or the endpoint.

## User accounts

Accounts are created only by the owner on `/admin` (no self-signup). Deactivate rather than delete when someone leaves — many tables FK-reference `profiles`, so deletion requires scrubbing history first. The first owner account on a fresh database is seeded with `npx tsx scripts/create-owner.ts`.

## E2E test residue

If a Playwright write run was interrupted, production may contain rows named `E2E TEST …`. Clean them with `npx tsx scripts/e2e/cleanup-test-data.ts --apply`, then remove the test accounts with `npx tsx scripts/e2e/teardown-test-users.ts --apply`. Full procedure in [testing.md](testing.md).
