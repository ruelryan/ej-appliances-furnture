/**
 * Creates the five temporary E2E test accounts (one per role) used by the
 * Playwright suite. Dry-run by default — prints what it would create.
 *   npx tsx scripts/e2e/setup-test-users.ts           # dry run
 *   npx tsx scripts/e2e/setup-test-users.ts --apply   # create for real
 *
 * On --apply, writes emails, generated passwords and user UUIDs to .env.e2e
 * at the repo root (gitignored via the .env* rule). Playwright's config and
 * the cleanup/teardown scripts read that file.
 *
 * Delete the accounts afterwards with teardown-test-users.ts — never leave
 * them active. Names are deliberately unmistakable.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const ACCOUNTS = [
  { key: "OWNER", email: "test-owner@eandj.test", role: "owner", name: "E2E TEST — DO NOT USE (Owner)" },
  { key: "ADMIN", email: "test-admin@eandj.test", role: "admin", name: "E2E TEST — DO NOT USE (Admin)" },
  { key: "COLLECTOR", email: "test-collector@eandj.test", role: "collector", name: "E2E TEST — DO NOT USE (Collector)" },
  { key: "AGENT", email: "test-agent@eandj.test", role: "sales_agent", name: "E2E TEST — DO NOT USE (Agent)" },
  { key: "DELIVERY", email: "test-delivery@eandj.test", role: "delivery", name: "E2E TEST — DO NOT USE (Delivery)" },
] as const;

async function main() {
  console.log(APPLY ? "APPLY mode — creating accounts.\n" : "DRY RUN — nothing will be created. Re-run with --apply.\n");
  for (const a of ACCOUNTS) {
    console.log(`  ${a.email.padEnd(30)} role=${a.role.padEnd(12)} "${a.name}"`);
  }
  if (!APPLY) return;

  const envLines: string[] = [
    "# E2E test accounts — created by scripts/e2e/setup-test-users.ts",
    `# ${new Date().toISOString()} — delete with teardown-test-users.ts when done`,
  ];

  for (const a of ACCOUNTS) {
    const password = crypto.randomBytes(9).toString("base64url") + "!2";
    const { data, error } = await db.auth.admin.createUser({
      email: a.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: a.name },
    });
    if (error) {
      console.error(`\n❌ ${a.email}: ${error.message}`);
      console.error("If it already exists, run teardown-test-users.ts first.");
      process.exit(1);
    }
    const userId = data.user.id;
    // handle_new_user trigger created the profile; set role + name.
    const { error: roleErr } = await db
      .from("profiles")
      .update({ role: a.role, full_name: a.name, active: true })
      .eq("id", userId);
    if (roleErr) {
      console.error(`\n❌ profile update for ${a.email}: ${roleErr.message}`);
      process.exit(1);
    }
    envLines.push(
      `E2E_${a.key}_EMAIL=${a.email}`,
      `E2E_${a.key}_PASSWORD=${password}`,
      `E2E_${a.key}_ID=${userId}`
    );
    console.log(`✅ created ${a.email} (${a.role})`);
  }

  fs.writeFileSync(".env.e2e", envLines.join("\n") + "\n");
  console.log("\n✅ Credentials written to .env.e2e (gitignored).");
  console.log("Verify: all five can log in, then run the Playwright suite.");
}

main();
