/**
 * Full JSON backup of every production table.
 *   npx tsx scripts/backup-prod.ts
 *
 * Writes to <home>\Documents\eandj-data\backup-<YYYY-MM-DD-HHmm>\ (outside the
 * repo — the dumps contain customer PII and must never be committed), or to
 * EANDJ_DATA_DIR if that is set. One <table>.json per table, plus
 * manifest.json with row counts and auth-users.json (auth accounts, no
 * secrets).
 *
 * The product-photos Storage bucket is NOT backed up — photos are
 * re-derivable from the pricelist import; noted in the manifest.
 *
 * Exits non-zero if any table's dumped row count disagrees with the
 * server-side count. Read-only: never writes to the database.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// Resolved from the home directory rather than a hardcoded profile name: the
// path was written on a machine whose Windows user was "ryan", so the script
// failed outright on any other. EANDJ_DATA_DIR overrides for a data folder
// kept somewhere else entirely.
const OUT_ROOT =
  process.env.EANDJ_DATA_DIR ??
  path.join(os.homedir(), "Documents", "eandj-data");

// Every table in migrations 0001–0032, with a stable sort column so
// paginated reads can't overlap or drop rows (PostgREST caps at 1000).
//
// This list is hand-maintained and that has already cost us once: it was
// written at 0027 and `remittances` (0030) was never added, so every backup
// between 0030 and 2026-08-29 — including the one taken before the 0029/0031/
// 0032 security audit — silently omitted the collector cash-custody ledger.
// A MIGRATION THAT ADDS A TABLE MUST ADD IT HERE IN THE SAME COMMIT.
const TABLES: Array<{ name: string; orderBy: string }> = [
  { name: "profiles", orderBy: "id" },
  { name: "customers", orderBy: "id" },
  { name: "contracts", orderBy: "id" },
  { name: "payments", orderBy: "id" },
  { name: "contract_notes", orderBy: "id" },
  { name: "audit_log", orderBy: "id" },
  { name: "bir_expenses", orderBy: "id" },
  { name: "id_counters", orderBy: "scope" },
  { name: "time_records", orderBy: "id" },
  { name: "employee_rates", orderBy: "id" },
  { name: "holidays", orderBy: "holiday_date" },
  { name: "time_correction_requests", orderBy: "id" },
  { name: "payslips", orderBy: "id" },
  { name: "dtr_locations", orderBy: "id" },
  { name: "collection_entries", orderBy: "id" },
  { name: "cash_advances", orderBy: "id" },
  { name: "cash_advance_expenses", orderBy: "id" },
  { name: "remittances", orderBy: "id" },
  { name: "commissions", orderBy: "id" },
  { name: "leads", orderBy: "id" },
  { name: "suppliers", orderBy: "id" },
  { name: "deliveries", orderBy: "id" },
  { name: "products", orderBy: "id" },
  { name: "stock_movements", orderBy: "id" },
  { name: "tasks", orderBy: "id" },
  { name: "task_comments", orderBy: "id" },
  { name: "product_photos", orderBy: "id" },
  { name: "contract_repricings", orderBy: "id" },
  { name: "ph_locations", orderBy: "id" },
  { name: "thirteenth_month_payments", orderBy: "id" },
];

const PAGE = 1000;

/**
 * A table named in TABLES that does not exist in the database yet.
 *
 * This is the normal case for the backup you take immediately BEFORE applying
 * the migration that creates it — and the house rule adds the table to TABLES
 * in the same commit as that migration, so the two are guaranteed to disagree
 * at exactly the moment a backup matters most. On 2026-08-31 that aborted the
 * pre-0039 dump outright and it had to be taken with an older copy of this
 * script.
 *
 * So: skip it, say so loudly, and record it in the manifest. Every OTHER error
 * still aborts — a permission failure or a dropped table must never be quietly
 * downgraded to "no rows".
 */
const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);

function isMissingTable(error: { code?: string; message?: string }): boolean {
  if (error.code && MISSING_TABLE_CODES.has(error.code)) return true;
  return /Could not find the table|does not exist/i.test(error.message ?? "");
}

async function dumpTable(name: string, orderBy: string): Promise<number | null> {
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from(name)
      .select("*")
      .order(orderBy, { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) {
      if (offset === 0 && isMissingTable(error)) return null;
      throw new Error(`${name}: ${error.message}`);
    }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  const { count, error: countErr } = await db
    .from(name)
    .select("*", { count: "exact", head: true });
  if (countErr) throw new Error(`${name} count: ${countErr.message}`);
  if (count !== rows.length) {
    throw new Error(
      `${name}: dumped ${rows.length} rows but server reports ${count} — aborting`
    );
  }
  fs.writeFileSync(outFile(name), JSON.stringify(rows, null, 1));
  return rows.length;
}

let outDir = "";
const outFile = (name: string) => path.join(outDir, `${name}.json`);

async function dumpAuthUsers(): Promise<number> {
  const users: unknown[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`auth users: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 200) break;
  }
  fs.writeFileSync(outFile("auth-users"), JSON.stringify(users, null, 1));
  return users.length;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function main() {
  if (!fs.existsSync(OUT_ROOT)) {
    console.error(`Output root not found: ${OUT_ROOT}`);
    process.exit(1);
  }
  outDir = path.join(OUT_ROOT, `backup-${stamp()}`);
  fs.mkdirSync(outDir);
  console.log(`Backing up to ${outDir}\n`);

  const counts: Record<string, number> = {};
  const missing: string[] = [];
  for (const t of TABLES) {
    const n = await dumpTable(t.name, t.orderBy);
    if (n === null) {
      missing.push(t.name);
      console.log(`  ${t.name.padEnd(28)} — not in this database, skipped`);
      continue;
    }
    counts[t.name] = n;
    console.log(`  ${t.name.padEnd(28)} ${n} rows`);
  }
  const authCount = await dumpAuthUsers();
  console.log(`  ${"auth users".padEnd(28)} ${authCount} accounts`);

  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    JSON.stringify(
      {
        created_at: new Date().toISOString(),
        // Read from the repo rather than hardcoded: this said "0027" while the
        // tree was on 0039, which is the kind of stale note that gets believed.
        repo_migration_high_water: repoMigrationHighWater(),
        tables: counts,
        // Named in TABLES but absent from the database — normally because this
        // dump was taken before the migration that creates them. Recorded so a
        // gap in the backup can never be mistaken for an empty table.
        missing_tables: missing,
        auth_users: authCount,
        notes:
          "Storage bucket product-photos NOT included (re-derivable from pricelist import). Counts verified against server-side exact counts.",
      },
      null,
      2
    )
  );

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const dumped = TABLES.length - missing.length;
  console.log(`\n✅ Backup complete: ${dumped} tables, ${total} rows, manifest written.`);
  if (missing.length) {
    console.log(
      `\n⚠  ${missing.length} table(s) in this script do not exist in the database ` +
        `and were skipped:\n   ${missing.join(", ")}\n` +
        `   Expected if you are backing up BEFORE applying the migration that ` +
        `creates them.\n   Recorded in manifest.json as missing_tables.`
    );
  }
}

/** Highest-numbered file in supabase/migrations, for the manifest. It is the
 *  REPO's high-water mark, which may be ahead of what is applied to the
 *  database this dump came from — hence the field name. */
function repoMigrationHighWater(): string {
  try {
    const dir = path.join(process.cwd(), "supabase", "migrations");
    const nums = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.slice(0, 4))
      .sort();
    return nums.at(-1) ?? "unknown";
  } catch {
    return "unknown";
  }
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
