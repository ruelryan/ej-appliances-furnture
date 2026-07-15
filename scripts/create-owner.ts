/**
 * Creates (or promotes) the owner account.
 *   npx tsx scripts/create-owner.ts <email> <full name> [password]
 * If no password is given, a random temporary one is generated and printed.
 */
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const [email, fullName, passwordArg] = process.argv.slice(2);
if (!email || !fullName) {
  console.error('Usage: npx tsx scripts/create-owner.ts <email> "<full name>" [password]');
  process.exit(1);
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function main() {
  const password =
    passwordArg ?? crypto.randomBytes(9).toString("base64url") + "!2";

  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  let userId: string;
  if (error) {
    if (!/already/i.test(error.message)) {
      console.error("Failed to create user:", error.message);
      process.exit(1);
    }
    const { data: list } = await db.auth.admin.listUsers();
    const existing = list.users.find((u) => u.email === email);
    if (!existing) {
      console.error("User reported as existing but not found.");
      process.exit(1);
    }
    userId = existing.id;
    console.log(`User ${email} already exists — promoting to owner.`);
  } else {
    userId = data.user.id;
    console.log(`Created user ${email}.`);
    console.log(`Temporary password: ${password}`);
  }

  const { error: roleErr } = await db
    .from("profiles")
    .upsert({ id: userId, full_name: fullName, role: "owner", active: true });

  if (roleErr) {
    console.error("Failed to set owner role:", roleErr.message);
    process.exit(1);
  }
  console.log(`✅ ${fullName} <${email}> is now an active OWNER.`);
}

main();
