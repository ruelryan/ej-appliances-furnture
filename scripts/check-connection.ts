/**
 * Quick sanity check that .env.local points at a reachable Supabase project.
 *   npx tsx scripts/check-connection.ts
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function main() {
  // Admin API works even before migrations exist
  const { data, error } = await db.auth.admin.listUsers();
  if (error) {
    console.error("❌ Connection failed:", error.message);
    process.exit(1);
  }
  console.log(`✅ Connected to Supabase. Auth users: ${data.users.length}`);

  // head requests don't surface missing-table errors reliably — use a real select
  const { error: tblError } = await db.from("customers").select("id").limit(1);
  console.log(
    tblError
      ? "⏳ Schema not applied yet (customers table missing) — run the migrations next."
      : "✅ Schema already applied (customers table exists)."
  );
}

main();
