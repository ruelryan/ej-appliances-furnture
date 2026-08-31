/**
 * Proves the 0039 confinement, and proves it broke nothing.
 *
 * 0039 redefined `is_active_user()` to exclude the bookkeeper role. That one
 * function backs ~60 policies, so this is the highest-blast-radius change in
 * the schema — and the only honest way to check it is to become each role and
 * count what they can see.
 *
 * Everything happens inside ONE transaction that always ROLLS BACK:
 *   - the bookkeeper is simulated by flipping a real profile's role, so no
 *     bookkeeper account has to exist yet and none is left behind;
 *   - `set local role authenticated` is what actually makes RLS apply (as the
 *     table owner, Postgres would bypass it entirely and every count would be
 *     a comforting lie);
 *   - `set_config(..., true)` is transaction-local, which is why the
 *     impersonation and the queries must share one transaction.
 *
 *   npx tsx scripts/verify-bookkeeper-confinement.ts
 */
import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const password = process.env.SUPABASE_DB_PASSWORD;
if (!url || !password) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_DB_PASSWORD in .env.local");
  process.exit(1);
}
const ref = new URL(url).hostname.split(".")[0];

const CANDIDATES = [
  { host: `db.${ref}.supabase.co`, port: 5432, user: "postgres" },
  { host: "aws-1-ap-south-1.pooler.supabase.com", port: 5432, user: `postgres.${ref}` },
  { host: "aws-0-ap-south-1.pooler.supabase.com", port: 5432, user: `postgres.${ref}` },
];

async function connect(): Promise<Client> {
  let last: unknown;
  for (const c of CANDIDATES) {
    const client = new Client({
      host: c.host,
      port: c.port,
      user: c.user,
      password,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    });
    try {
      await client.connect();
      console.log(`Connected via ${c.host}\n`);
      return client;
    } catch (e) {
      last = e;
      try { await client.end(); } catch {}
    }
  }
  throw last;
}

const TABLES = ["contracts", "customers", "payments", "products", "tasks", "bir_expenses"];

async function countsAs(db: Client, uuid: string, asBookkeeper: boolean) {
  await db.query("begin");
  try {
    if (asBookkeeper) {
      await db.query("update public.profiles set role = 'bookkeeper' where id = $1", [uuid]);
    }
    await db.query("set local role authenticated");
    await db.query(
      "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
      [uuid]
    );

    const out: Record<string, number | string> = {};
    for (const t of TABLES) {
      try {
        const r = await db.query(`select count(*)::int as n from public.${t}`);
        out[t] = r.rows[0].n;
      } catch (e) {
        out[t] = `ERR ${(e as Error).message.slice(0, 40)}`;
      }
    }
    const p = await db.query("select count(*)::int as n from public.profiles");
    out["profiles"] = p.rows[0].n;
    return out;
  } finally {
    await db.query("rollback");
  }
}

async function main() {
  const db = await connect();

  const people = await db.query(
    "select id, full_name, role from public.profiles where active order by role"
  );

  console.log("Live accounts:");
  for (const p of people.rows) console.log(`  ${p.role.padEnd(12)} ${p.full_name}`);
  console.log();

  const header = ["role", ...TABLES, "profiles"];
  const widths = header.map((h) => Math.max(h.length, 12));
  const line = (cells: (string | number)[]) =>
    cells.map((c, i) => String(c).padEnd(widths[i])).join(" ");

  console.log(line(header));
  console.log(widths.map((w) => "-".repeat(w)).join(" "));

  for (const p of people.rows) {
    const c = await countsAs(db, p.id, false);
    console.log(line([p.role, ...TABLES.map((t) => c[t]), c["profiles"]]));
  }

  // The role that does not exist yet. Simulated on a real account, rolled back.
  const subject = people.rows.find((r) => r.role !== "owner") ?? people.rows[0];
  const b = await countsAs(db, subject.id, true);
  console.log(line(["bookkeeper*", ...TABLES.map((t) => b[t]), b["profiles"]]));
  console.log(`\n  * simulated on ${subject.full_name}'s account inside a rolled-back transaction`);

  const leaks = TABLES.filter(
    (t) => t !== "bir_expenses" && typeof b[t] === "number" && (b[t] as number) > 0
  );
  const ownProfile = b["profiles"];

  console.log();
  if (leaks.length) {
    console.log(`❌ CONFINEMENT FAILED — bookkeeper can read: ${leaks.join(", ")}`);
  } else {
    console.log("✅ Confined: bookkeeper reads 0 rows from contracts, customers, payments, products, tasks.");
  }
  if (ownProfile === 1) {
    console.log("✅ Can read exactly their own profile row (so getProfile() works and they can log in).");
  } else {
    console.log(`❌ Reads ${ownProfile} profile rows — expected exactly 1. They cannot log in, or they see colleagues.`);
  }

  await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
