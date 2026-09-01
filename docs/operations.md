# Operations — deploy, backup, migrations, imports

Day-to-day operational procedures. The app is deployed on Vercel and backed by a single Supabase project — **there is no staging environment**; production is the only database. That fact drives most of the caution below.

## Environments

| Thing | Value |
|---|---|
| Production URL | https://eandj-chi.vercel.app |
| Supabase project | `trjlqcvhrgggcvsxxaml`, region ap-south-1 (pooler `aws-1-ap-south-1.pooler.supabase.com`) |
| GitHub | `ruelryan/ej-appliances-furnture`; **work from `main`** — it is current and is what production runs (`redesign/fintech-light` was folded in at 3415c47, 2026-08-17). Two branches survive on purpose: `redesign/fintech-light`, which still holds the one unmerged `/help` commit, and the parked `old-vite-app` |
| Local dev | `npm run dev` on localhost:3000 — **points at the production database** |

`.env.local` (gitignored) holds `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_DB_PASSWORD` (quote it — it contains `#`). Sanity-check with `npx tsx scripts/check-connection.ts`.

**`OWNER_SIGNATURE_DATA_URI`** — the owner's signature for `/print/demand-letter/[id]`, as a `data:image/png;base64,…` URI (~7KB trimmed transparent PNG). It is an env var and **not a file in the repo on purpose**: `ruelryan/ej-appliances-furnture` is **public**, git history is permanent, and anything under `public/` is served with no auth — a signature that authenticates contracts, demand letters and amendments must not be published. Read in a server component, it only ever reaches the HTML of an owner/admin-gated page. Set it in Vercel under **Production** scope, like the Supabase keys. **Unset is a safe state, not a break**: the letter falls back to a blank ruled line to sign by hand, which is what every local checkout and Preview deploy gets. To regenerate from a scan: trim the whitespace, threshold to a transparent PNG ~520px wide, and base64 it.

## Deploying

There are **two** ways code reaches production, and both are live:

1. **Pushing to `main` deploys it automatically.** The Vercel project ("eandj", org `melonminds`) is connected to `ruelryan/ej-appliances-furnture`. Any push to `main` builds and promotes to production with no further action; a push to any other branch builds a Preview.
2. **`vercel --prod` from the local checkout**, which deploys the working tree regardless of what is on GitHub.

`npm run build` must pass before either. There is no CI test pipeline — nothing runs `npm test` or the e2e suite before a deploy, so a red test does not block production.

**Migrations are NOT part of either path.** They are applied by hand with `npx tsx scripts/apply-migrations.ts <n>`. Because a push to `main` deploys on its own, **apply the migration before pushing** any commit that depends on one. The reverse order is a real outage: 0031 added `unlink_collection_payment` and the `p_force` argument, and the app code calling them would have failed against a database that did not have them yet.

To verify how a given deployment was triggered, run `vercel inspect <url>`. A Git-triggered build carries an `eandj-git-<branch>-melonminds.vercel.app` alias; a CLI build does not. Note that `vercel project inspect` prints no Git section at all in CLI 58.x — do not read its silence as "not connected".

## Backups

**Take a backup before anything destructive.** Full JSON dumps have already made two risky operations recoverable.

```
npx tsx scripts/backup-prod.ts
```

- Dumps **all 30 tables** plus the auth user list to `<home>\Documents\eandj-data\backup-<date>\` (resolved from `os.homedir()`; set `EANDJ_DATA_DIR` to override — the path was once hardcoded to a `ryan` profile and the script failed outright on any other machine), one JSON file per table, with a `manifest.json` of row counts verified against server-side exact counts (the script fails loudly on any mismatch).
- Reads are paginated past PostgREST's 1000-row cap with a stable `.order()` — never remove that (unordered pagination silently drops rows).
- The `product-photos` Storage bucket is **not** included — photos are re-derivable from the pricelist import.
- **When a new table is added in a migration, add it to the script's `TABLES` list in the same commit.** This rule was already written here and was still missed: `remittances` (0030) went unlisted until 2026-08-29, so every backup in that window — including the one taken before the 0029/0031/0032 security audit — omitted the collector cash-custody ledger. **The manifest cannot catch this**: it verifies row counts for the tables it dumped, so a table absent from `TABLES` is absent from its own check.
- **A listed table that does not exist yet is skipped, not fatal.** It prints a warning and is recorded in the manifest as `missing_tables`. That is exactly the state of the backup you take immediately *before* applying the migration that creates the table — and because the rule above puts the table in `TABLES` in the same commit as the migration, the two are guaranteed to disagree at the moment a backup matters most. Before this was fixed (2026-08-31) the pre-0039 dump aborted and had to be taken with an older copy of the script. Every other error still aborts: a permission failure or a genuinely dropped table must never be downgraded to "no rows".
- `/api/backup` (the cron route) had the mirror-image bug and it was the more dangerous one: it discarded the error from its probe query, so a table that did not exist came back as an empty array and was written into the dump as a real, empty table — a hole you could not see. It now reports missing tables the same way.
- The `eandj-data` folder is outside the repo because the dumps contain customer PII. Never commit anything from it.

The owner also keeps the weekly CSV-export habit (`/api/export/*`) as a second, human-readable layer.

## Migrations

Migration files live in `supabase/migrations/`, numbered `0001`–`0032` (all applied to prod). Apply a single new one with:

```
npx tsx scripts/apply-migrations.ts 0033
```

Before writing a migration, read the gotchas in CLAUDE.md — the most dangerous are:

- **The frozen-view trap**: `v_contract_financials` enumerates its columns by hand (never `c.*`); `v_contract_collections` must be DROPPED and recreated, never replaced; dropping `v_contract_financials` requires dropping its four dependents (`v_contract_collections`, `v_aging`, `v_dashboard_stats`, `v_top_customers`) first and recreating all of them.
- `create or replace function` with a changed argument list creates an **overload** and PostgREST `rpc()` becomes ambiguous — `drop function` first.
- Verify math changes with `npx tsx scripts/verify-sql-terms.ts` and `npx tsx scripts/verify-dtr.ts`.

## Data imports

- `npx tsx scripts/migrate/import.ts --dir <csvs> [--load]` — re-import from Sheet CSVs (the 2026-07-20 cutover). **A re-import wipes `id_counters`** and the importer now reseeds them; if a future import misbehaves, re-run migration 0025 (idempotent).
- `npx tsx scripts/extract-tabs.ts`, `import-locations.ts`, `backfill-addresses.ts`, `backfill-photo-hashes.ts`, `import-pricelist.ts` — see each script's header.
- `npx tsx scripts/sync-sheet-divergence.ts [--apply]` — folds the Google Sheet's post-cutover drift back into the app. The Sheet kept being used after the 2026-07-20 cutover, so both systems minted IDs independently; the first reconciliation (2026-08-20) brought in 26 sales and ₱146,985 of payments, renumbered one collided contract, and left prod at 1,539 contracts / 1,149 customers / 6,022 payments. It is **idempotent** and re-derives the whole diff from the workbook each run, so it is also the tool for the next month's drift — but the fix is to stop entering sales in the Sheet, not to keep re-syncing. Two things it establishes permanently: **`PAY####` numbers diverged from PAY5939** (the same number means a different payment in each system, so the Sheet's payment number is not a lookup key for anything after PAY5938 — join on contract + date + amount), and a contract number the Sheet has already spent is invisible to `id_counters`.
- House pattern for all one-off data scripts: **dry-run by default, `--apply` to write**, report printed first, service-role key (bypasses RLS — scripts cannot call RPCs guarded by `can_post_payments()` because those read `auth.uid()`).

### Writing money data from a script

The service-role key bypasses RLS, which means a script that uses it has to write tables directly and therefore **reimplements** whatever `compute_terms`, `id_counters`, the delivery trigger and the 0032 payment caps would have done. For anything money-shaped that is the wrong tool — every one of those is a chance to get the arithmetic subtly wrong.

Connect with `pg` instead (`SUPABASE_DB_PASSWORD`, and the connect helper in `apply-migrations.ts`), open a transaction, and impersonate a real user:

```sql
select set_config('request.jwt.claims',
                  json_build_object('sub', '<user uuid>', 'role', 'authenticated')::text,
                  true);
```

Every guarded RPC then behaves exactly as it does in the browser. `set_config(..., true)` is transaction-local, so the impersonation and the calls must share one transaction — which also gives a genuine dry run for free: do the entire run and `rollback` instead of `commit`, and the rehearsal exercises the same code path as the real thing rather than a separate untested one. `sync-sheet-divergence.ts` is the worked example.

**Trap when a script compares dates through `pg`:** node-postgres parses a `date` column into a JS `Date` built in the machine's local zone, which both shifts the day and silently breaks every string comparison against a CSV or Sheet value. Set `pg.types.setTypeParser(1082, (v) => v)` first to get the raw `'YYYY-MM-DD'` back. This made the first reconciliation run believe all 6,009 payments were missing. `@supabase/supabase-js` goes through PostgREST/JSON and does **not** have this problem — only `pg` does.

## Keep-alive

Supabase's free tier pauses after ~7 idle days. `.github/workflows/keepalive.yml` pings `https://eandj-chi.vercel.app/api/health` daily to prevent that. Don't delete the workflow or the endpoint.

## User accounts

Accounts are created only by the owner on `/admin` (no self-signup). Deactivate rather than delete when someone leaves — many tables FK-reference `profiles`, so deletion requires scrubbing history first. The first owner account on a fresh database is seeded with `npx tsx scripts/create-owner.ts`.

## E2E test residue

If a Playwright write run was interrupted, production may contain rows named `E2E TEST …`. Clean them with `npx tsx scripts/e2e/cleanup-test-data.ts --apply`, then remove the test accounts with `npx tsx scripts/e2e/teardown-test-users.ts --apply`. Full procedure in [testing.md](testing.md).
