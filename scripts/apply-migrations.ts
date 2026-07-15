/**
 * Applies supabase/migrations/*.sql directly to the project database.
 * Needs SUPABASE_DB_PASSWORD in .env.local (the database password from
 * project creation). Tries the direct host first, then the IPv4 poolers.
 *
 *   npx tsx scripts/apply-migrations.ts              # all files (fresh DB only)
 *   npx tsx scripts/apply-migrations.ts 0003         # only files matching "0003"
 */
import fs from "node:fs";
import path from "node:path";
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

const REGIONS = [
  "ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "ap-northeast-2",
  "ap-south-1", "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1", "eu-central-2",
  "eu-north-1", "ca-central-1", "sa-east-1",
];

const CANDIDATES = [
  { host: `db.${ref}.supabase.co`, port: 5432, user: "postgres" },
  ...REGIONS.flatMap((r) => [
    { host: `aws-1-${r}.pooler.supabase.com`, port: 5432, user: `postgres.${ref}` },
    { host: `aws-0-${r}.pooler.supabase.com`, port: 5432, user: `postgres.${ref}` },
  ]),
];

async function connect(): Promise<Client> {
  const errors: string[] = [];
  for (const c of CANDIDATES) {
    const client = new Client({
      host: c.host,
      port: c.port,
      user: c.user,
      password,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10_000,
    });
    try {
      await client.connect();
      console.log(`Connected via ${c.host}`);
      return client;
    } catch (e) {
      errors.push(`${c.host}: ${(e as Error).message}`);
    }
  }
  console.error("Could not connect to the database:\n  " + errors.join("\n  "));
  process.exit(1);
}

async function main() {
  const client = await connect();

  const filter = process.argv[2];
  const dir = path.join("supabase", "migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && (!filter || f.includes(filter)))
    .sort();
  if (files.length === 0) {
    console.error(`No migration files match "${filter}"`);
    process.exit(1);
  }

  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    process.stdout.write(`Applying ${f} … `);
    try {
      await client.query(sql);
      console.log("✅");
    } catch (e) {
      console.log("❌");
      console.error((e as Error).message);
      await client.end();
      process.exit(1);
    }
  }

  // PostgREST caches the schema — tell it to reload so the API sees new objects
  await client.query("notify pgrst, 'reload schema';");
  await client.end();
  console.log("\nAll migrations applied and API schema cache reloaded.");
}

main();
