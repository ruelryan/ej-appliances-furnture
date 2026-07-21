/**
 * Deletes the five E2E test accounts created by setup-test-users.ts.
 * Dry-run by default.
 *   npx tsx scripts/e2e/teardown-test-users.ts           # dry run
 *   npx tsx scripts/e2e/teardown-test-users.ts --apply   # delete for real
 *
 * SAFETY: many tables reference profiles with plain (restrict) FKs, so
 * auth.admin.deleteUser fails while any row created by a test user
 * remains. This script scans every profile-referencing column first and
 * REFUSES to delete while data exists — run cleanup-test-data.ts --apply
 * before this one. employee_rates cascades with the profile.
 *
 * On success, archives the deleted accounts to
 * C:\Users\ryan\Documents\eandj-data\deleted-e2e-accounts-<date>.json
 * (same precedent as the 2026-07-20 sample-account deletion).
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.e2e" });

const APPLY = process.argv.includes("--apply");

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const KEYS = ["OWNER", "ADMIN", "COLLECTOR", "AGENT", "DELIVERY"] as const;

// Every column that FK-references profiles(id) across migrations 0001–0027,
// except employee_rates.id (on delete cascade with the profile).
const PROFILE_REFS: Array<{ table: string; columns: string[] }> = [
  { table: "contracts", columns: ["created_by", "collector_id", "agent_id"] },
  { table: "payments", columns: ["recorded_by", "voided_by"] },
  { table: "contract_notes", columns: ["created_by"] },
  { table: "customers", columns: ["gps_tagged_by"] },
  { table: "time_records", columns: ["profile_id", "created_by"] },
  { table: "time_correction_requests", columns: ["profile_id", "resolved_by"] },
  { table: "payslips", columns: ["profile_id", "finalized_by", "created_by"] },
  { table: "thirteenth_month_payments", columns: ["profile_id", "created_by"] },
  { table: "collection_entries", columns: ["collector_id", "posted_by", "cancelled_by"] },
  { table: "cash_advances", columns: ["collector_id", "requested_by", "issued_by", "closed_by"] },
  { table: "cash_advance_expenses", columns: ["created_by"] },
  { table: "commissions", columns: ["agent_id", "paid_by", "voided_by", "created_by"] },
  { table: "leads", columns: ["agent_id", "resolved_by"] },
  { table: "deliveries", columns: ["delivered_by"] },
  { table: "stock_movements", columns: ["created_by"] },
  { table: "product_photos", columns: ["created_by"] },
  { table: "contract_repricings", columns: ["proposed_by", "confirmed_by"] },
  { table: "tasks", columns: ["created_by", "assignee_id", "completed_by"] },
  { table: "task_comments", columns: ["created_by"] },
];

async function main() {
  const ids = KEYS.map((k) => ({
    key: k,
    id: process.env[`E2E_${k}_ID`],
    email: process.env[`E2E_${k}_EMAIL`],
  }));
  const missing = ids.filter((a) => !a.id);
  if (missing.length) {
    console.error(`❌ .env.e2e missing IDs for: ${missing.map((m) => m.key).join(", ")}`);
    console.error("Nothing to tear down (or setup was never applied).");
    process.exit(1);
  }
  const uuids = ids.map((a) => a.id!) as string[];

  console.log(APPLY ? "APPLY mode.\n" : "DRY RUN — nothing will be deleted. Re-run with --apply.\n");
  console.log("Scanning for rows still referencing the test accounts…");

  let blocked = 0;
  for (const ref of PROFILE_REFS) {
    for (const col of ref.columns) {
      const { count, error } = await db
        .from(ref.table)
        .select("*", { count: "exact", head: true })
        .in(col, uuids);
      if (error) {
        console.error(`❌ scan ${ref.table}.${col}: ${error.message}`);
        process.exit(1);
      }
      if (count && count > 0) {
        console.log(`  BLOCKED: ${ref.table}.${col} has ${count} row(s)`);
        blocked += count;
      }
    }
  }

  if (blocked > 0) {
    console.error(
      `\n❌ ${blocked} row(s) still reference the test accounts. Run:\n` +
        "   npx tsx scripts/e2e/cleanup-test-data.ts --apply\nthen re-run this script."
    );
    process.exit(1);
  }
  console.log("  Clean — no referencing rows.\n");

  if (!APPLY) {
    for (const a of ids) console.log(`  would delete ${a.email} (${a.id})`);
    return;
  }

  // Archive account records before deletion (2026-07-20 precedent).
  const { data: list, error: listErr } = await db.auth.admin.listUsers();
  if (listErr) {
    console.error(`❌ listUsers: ${listErr.message}`);
    process.exit(1);
  }
  const archive = list.users.filter((u) => uuids.includes(u.id));
  const archivePath = path.join(
    "C:\\Users\\ryan\\Documents\\eandj-data",
    `deleted-e2e-accounts-${new Date().toISOString().slice(0, 10)}.json`
  );
  fs.writeFileSync(archivePath, JSON.stringify(archive, null, 2));
  console.log(`Archived ${archive.length} account record(s) to ${archivePath}`);

  for (const a of ids) {
    const { error } = await db.auth.admin.deleteUser(a.id!);
    if (error) {
      console.error(`❌ delete ${a.email}: ${error.message}`);
      process.exit(1);
    }
    console.log(`✅ deleted ${a.email}`);
  }

  const { data: after } = await db.auth.admin.listUsers();
  console.log(`\n✅ Done. Remaining auth users: ${after?.users.length ?? "?"} (expect 3 real staff).`);
  console.log("You can delete .env.e2e now.");
}

main();
