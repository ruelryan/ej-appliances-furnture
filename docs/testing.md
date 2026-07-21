# Testing

Three layers: Vitest unit tests for the business math, verification scripts that compare SQL against golden fixtures, and a Playwright end-to-end suite. **The e2e suite runs against the production database** — there is no staging — so it is split into an always-safe read-only suite and a carefully-fenced write suite with a mandatory backup/cleanup procedure.

## Unit tests (Vitest)

```
npm test                                            # all
npx vitest run src/lib/__tests__/amortization.test.ts   # one file
```

- `src/lib/__tests__/amortization.test.ts` — `computeTerms` against `GOLDEN_CASES` plus `monthsElapsed` date math. If a term formula ever changes, this and the SQL must change together.
- `src/lib/__tests__/format.test.ts` — formatting helpers.

## SQL verification scripts

```
npx tsx scripts/verify-sql-terms.ts   # SQL compute_terms vs the TS golden fixture
npx tsx scripts/verify-dtr.ts         # dtr_hours(), Easter, holidays, distance_m goldens
```

Run both after touching any SQL math.

## End-to-end suite (Playwright)

```
npm run e2e:readonly   # safe any time — read-only page/role coverage
npm run e2e:writes     # WRITES TO PRODUCTION — follow the procedure below
```

Configuration is `playwright.config.ts`. Two settings are **load-bearing and must never change**: `workers: 1` and `retries: 0` — a retried or concurrent write spec would double-write to the live business database. The suite starts `npm run dev` itself (or reuses a running one) and waits on `/api/health`.

**Never run this in CI and never point it at the Vercel URL.** CI must not hold production-write credentials, and the deployed site serves real users.

### Test accounts

Five throwaway accounts (`test-owner@eandj.test` … `test-delivery@eandj.test`, display names "E2E TEST — DO NOT USE (…)"), one per role:

```
npx tsx scripts/e2e/setup-test-users.ts --apply      # create; writes .env.e2e
npx tsx scripts/e2e/teardown-test-users.ts --apply   # delete when done
```

`.env.e2e` (gitignored) holds their emails, passwords, and UUIDs; `e2e/global-setup.ts` logs each in through the real `/login` form and stores per-role session state in `e2e/.auth/`. Teardown scans every profile-referencing FK column first and refuses to run while any test-created rows remain.

### Read-only suite (`e2e/specs/readonly/`)

- `auth.spec.ts` — unauthenticated redirects, `/api/health`, wrong-password error, logged-in `/login` bounce.
- `owner.spec.ts` — every app route renders for the owner, plus a contract and customer detail page.
- `role-gates.spec.ts` — the page-gate matrix per role (matching the real `redirect()` gates; pages without gates rely on RLS and get nav-hiding assertions instead).
- `export-api.spec.ts` — CSV exports: owner 200, others 403, unauthenticated → login.
- `print.spec.ts` — every `/print/*` page renders with real ids; empty datasets skip.
- `aa-guard-start` / `zz-guard-end` — record the `audit_log` high-water mark and prove no test account wrote anything during the run (concurrent writes by real staff are ignored).

### Write suite (`e2e/specs/writes/`) — the full procedure

Run in one sitting, preferably outside working hours, and never leave TEST rows overnight:

1. **Backup**: `npx tsx scripts/backup-prod.ts` — verify the manifest counts.
2. **Accounts**: `setup-test-users.ts --apply` if `.env.e2e` doesn't exist yet.
3. **Run**: `npm run e2e:writes`. Specs run in filename order and build on each other: `10-contract` (TEST customer + back-dated ₱1,000 6-month contract; asserts the golden math, the auto-enqueued delivery, and that no commission row appears) → `20-payment` (record ₱250, void, restore) → `30-collections` (assign collector, log collected + promised entries, post one, cancel the other) → `40-tasks` (person-assigned only — never role-assigned, which would broadcast to real staff) → `50-products` (create/restock/adjust the TEST product) → `60-delivery` (in-stock fulfilment decrements stock with a ledger row) → `70-dtr` (geolocation-stubbed clock in/out; one block per day) → `80-payroll` (draft payslip create/print/delete — self-cleaning) → `90-leads` (submit + reject; never convert) → `95-repossession` (stage round-trip).
4. **Cleanup**: `npx tsx scripts/e2e/cleanup-test-data.ts` (dry-run, review the report) then `--apply`. It deletes in FK dependency order and re-scans to prove zero TEST rows remain.
5. **Teardown**: `npx tsx scripts/e2e/teardown-test-users.ts --apply`, then delete `.env.e2e`.

### Deliberately untested writes

`merge_products` (irreversible), lead conversion (creates a second contract), repricing confirm (needs an elapsed Good-as-Cash term and a signed amendment), payslip finalize, 13th-month payment recording, holiday/geofence edits, cash-advance issue/close, `create_product_for_contract` (auto-creates a review task the real admin would see). Cover these read-only or manually.

### Accepted costs of a write run (disclosed, permanent or temporary)

- `id_counters` gaps: the TEST contract consumes a `YYYY###` number and each posted payment a `PAY####`; after cleanup those numbers simply never existed. Cosmetic. **Never decrement counters.**
- Between the contract spec and cleanup, the TEST contract adds ₱1,000 to a past month's sales on `/analytics` (it is back-dated ~2 months to appear on the collector worklist).
- Hard-deleting TEST payments is a sanctioned service-role exception to the app's "payments are never deleted — void/restore" rule: clearly-marked TEST rows only, after a verified backup.

### Re-running

The specs guard themselves: `10-contract` and `50-products` skip if TEST rows already exist (run cleanup first), `70-dtr` skips if the test collector already punched that day.
