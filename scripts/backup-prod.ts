/**
 * Full JSON backup of every production table.
 *   npx tsx scripts/backup-prod.ts
 *
 * Writes to C:\Users\ryan\Documents\eandj-data\backup-<YYYY-MM-DD-HHmm>\
 * (outside the repo — the dumps contain customer PII and must never be
 * committed). One <table>.json per table, plus manifest.json with row
 * counts and auth-users.json (auth accounts, no secrets).
 *
 * The product-photos Storage bucket is NOT backed up — photos are
 * re-derivable from the pricelist import; noted in the manifest.
 *
 * Exits non-zero if any table's dumped row count disagrees with the
 * server-side count. Read-only: never writes to the database.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const OUT_ROOT = "C:\\Users\\ryan\\Documents\\eandj-data";

// Every table in migrations 0001–0027, with a stable sort column so
// paginated reads can't overlap or drop rows (PostgREST caps at 1000).
const TABLES: Array<{ name: string; orderBy: string }> = [
  { name: "profiles", orderBy: "id" },
  { name: "customers", orderBy: "id" },
  { name: "contracts", orderBy: "id" },
  { name: "payments", orderBy: "id" },
  { name: "contract_notes", orderBy: "id" },
  { name: "audit_log", orderBy: "id" },
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

async function dumpTable(name: string, orderBy: string): Promise<number> {
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from(name)
      .select("*")
      .order(orderBy, { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`${name}: ${error.message}`);
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
  for (const t of TABLES) {
    counts[t.name] = await dumpTable(t.name, t.orderBy);
    console.log(`  ${t.name.padEnd(28)} ${counts[t.name]} rows`);
  }
  const authCount = await dumpAuthUsers();
  console.log(`  ${"auth users".padEnd(28)} ${authCount} accounts`);

  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    JSON.stringify(
      {
        created_at: new Date().toISOString(),
        migration_high_water: "0027",
        tables: counts,
        auth_users: authCount,
        notes:
          "Storage bucket product-photos NOT included (re-derivable from pricelist import). Counts verified against server-side exact counts.",
      },
      null,
      2
    )
  );

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`\n✅ Backup complete: ${TABLES.length} tables, ${total} rows, manifest written.`);
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
