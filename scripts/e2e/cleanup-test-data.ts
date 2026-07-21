/**
 * Finds and hard-deletes every row the E2E write suite created, in FK
 * dependency order. Dry-run by default — prints a per-table report.
 *   npx tsx scripts/e2e/cleanup-test-data.ts           # dry run
 *   npx tsx scripts/e2e/cleanup-test-data.ts --apply   # delete for real
 *
 * Identification: rows carrying the "E2E TEST" name prefix (customers,
 * products, tasks, leads) plus everything hanging off them (contracts of
 * TEST customers; payments/entries/deliveries/notes/repricings of those
 * contracts; stock movements of TEST products) plus rows keyed to the
 * test-account UUIDs in .env.e2e (time records, payslips, advances...).
 *
 * Hard-deleting payments contradicts the app's "void, never delete" rule
 * on purpose: it applies only to clearly-marked TEST rows, after the
 * full JSON backup (scripts/backup-prod.ts). Never widen this script's
 * matching. id_counters are NEVER decremented — consumed numbers stay
 * consumed (a permanent, cosmetic gap in the series).
 *
 * After --apply it re-scans and reports zero remaining TEST rows, then
 * you can run teardown-test-users.ts.
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.e2e" });

const APPLY = process.argv.includes("--apply");
const PREFIX = "E2E TEST%";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const KEYS = ["OWNER", "ADMIN", "COLLECTOR", "AGENT", "DELIVERY"] as const;

function testUserIds(): string[] {
  const ids = KEYS.map((k) => process.env[`E2E_${k}_ID`]).filter(Boolean) as string[];
  if (ids.length === 0) {
    console.error("❌ .env.e2e has no test-user IDs — nothing to clean.");
    process.exit(1);
  }
  return ids;
}

async function ids(table: string, select: string, filter: (q: any) => any): Promise<string[]> {
  const { data, error } = await filter(db.from(table).select(select));
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []).map((r: any) => r[select.split(",")[0].trim()]);
}

async function del(table: string, column: string, values: string[], label?: string): Promise<number> {
  if (values.length === 0) return 0;
  if (!APPLY) {
    const { count, error } = await db
      .from(table)
      .select("*", { count: "exact", head: true })
      .in(column, values);
    if (error) throw new Error(`${table} scan: ${error.message}`);
    if (count) console.log(`  would delete ${String(count).padStart(3)} row(s) from ${label ?? table}`);
    return count ?? 0;
  }
  const { data, error } = await db.from(table).delete().in(column, values).select("*");
  if (error) throw new Error(`${table} delete: ${error.message}`);
  if (data?.length) console.log(`  deleted ${String(data.length).padStart(3)} row(s) from ${label ?? table}`);
  return data?.length ?? 0;
}

async function main() {
  console.log(APPLY ? "APPLY mode — deleting TEST rows.\n" : "DRY RUN — nothing will be deleted. Re-run with --apply.\n");
  const userIds = testUserIds();

  // --- Discover the TEST object graph (read-only) -----------------------
  const testCustomers = await ids("customers", "id", (q) => q.ilike("last_name", PREFIX));
  const testProducts = await ids("products", "id", (q) => q.ilike("name", PREFIX));
  const testContracts = testCustomers.length
    ? await ids("contracts", "id", (q) => q.in("customer_id", testCustomers))
    : [];
  const testPayments = testContracts.length
    ? await ids("payments", "id", (q) => q.in("contract_id", testContracts))
    : [];
  const testDeliveries = testContracts.length
    ? await ids("deliveries", "id", (q) => q.in("contract_id", testContracts))
    : [];
  const testTasks = await ids("tasks", "id", (q) => q.ilike("title", PREFIX));

  console.log(
    `Found: ${testCustomers.length} customer(s), ${testContracts.length} contract(s), ` +
      `${testPayments.length} payment(s), ${testProducts.length} product(s), ${testTasks.length} task(s)\n`
  );

  let total = 0;

  // --- Delete in FK dependency order (children first) -------------------
  total += await del("task_comments", "task_id", testTasks, "task_comments (of TEST tasks)");
  total += await del("tasks", "id", testTasks);
  total += await del("collection_entries", "contract_id", testContracts, "collection_entries (FKs payments — before payments)");
  total += await del("stock_movements", "delivery_id", testDeliveries, "stock_movements (of TEST deliveries)");
  total += await del("stock_movements", "product_id", testProducts, "stock_movements (of TEST products)");
  total += await del("payments", "contract_id", testContracts, "payments (of TEST contracts)");
  total += await del("commissions", "contract_id", testContracts, "commissions (defensive — none expected)");
  total += await del("deliveries", "contract_id", testContracts, "deliveries (auto-enqueued)");
  total += await del("contract_notes", "contract_id", testContracts, "contract_notes");
  total += await del("contract_repricings", "contract_id", testContracts, "contract_repricings (defensive)");
  total += await del("leads", "agent_id", userIds, "leads (by test agent)");
  total += await del("contracts", "id", testContracts);
  total += await del("customers", "id", testCustomers);
  total += await del("product_photos", "product_id", testProducts, "product_photos (of TEST products)");
  total += await del("products", "id", testProducts);
  total += await del("time_correction_requests", "profile_id", userIds, "time_correction_requests (test users)");
  total += await del("time_records", "profile_id", userIds, "time_records (test users)");
  total += await del("payslips", "profile_id", userIds, "payslips (defensive — specs self-clean)");
  total += await del("thirteenth_month_payments", "profile_id", userIds, "13th-month payments (defensive)");
  total += await del("cash_advance_expenses", "created_by", userIds, "cash_advance_expenses (defensive)");
  total += await del("cash_advances", "collector_id", userIds, "cash_advances (defensive)");
  total += await del("audit_log", "changed_by", userIds, "audit_log (test-account entries, tidiness)");

  if (!APPLY) {
    console.log(`\nDry run complete — ${total} row(s) would be deleted.`);
    return;
  }

  // --- Verify zero remain ----------------------------------------------
  console.log("\nRe-scanning…");
  const leftovers: string[] = [];
  for (const [table, col] of [
    ["customers", "last_name"],
    ["products", "name"],
    ["tasks", "title"],
    ["leads", "customer_name"],
  ] as const) {
    const { count } = await db.from(table).select("*", { count: "exact", head: true }).ilike(col, PREFIX);
    if (count) leftovers.push(`${table}: ${count}`);
  }
  for (const [table, col] of [
    ["time_records", "profile_id"],
    ["payslips", "profile_id"],
    ["collection_entries", "collector_id"],
  ] as const) {
    const { count } = await db.from(table).select("*", { count: "exact", head: true }).in(col, userIds);
    if (count) leftovers.push(`${table}: ${count}`);
  }
  if (leftovers.length) {
    console.error(`❌ TEST rows remain after cleanup: ${leftovers.join(", ")}`);
    process.exit(1);
  }
  console.log(`\n✅ ${total} row(s) deleted; zero TEST rows remain.`);
  console.log("Safe to run: npx tsx scripts/e2e/teardown-test-users.ts --apply");
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
