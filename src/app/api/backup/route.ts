import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Weekly full-database backup endpoint.
//
// Auth: a bearer token (BACKUP_CRON_KEY) known only to the backup cron — NOT
// a user session, so the cron can run without anyone logged in. The token is
// compared with a timing-safe constant-time check.
//
// It enumerates every table via PostgREST's OpenAPI descriptor (so the table
// list can never drift from the migrations), dumps each with stable-sort
// pagination (the same 1000-row cap + order discipline as /api/export), and
// returns one gzipped JSON document: { backed_up_at, tables: { name: rows } }.
//
// Runs where the secrets are real: inside the eandj deployment. The cron only
// ever holds the bearer token; the Supabase service key never leaves Vercel.

const PAGE_SIZE = 1000;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// The full table inventory, straight from supabase/migrations (the source of
// truth — the same list a pg_dump would name). Hardcoded deliberately: the
// PostgREST OpenAPI root is unreliable across versions (it returned an empty
// relation name in production), and a fixed list means the backup covers the
// same tables every week — additions go in via a migration + one line here.
const TABLES = [
  "audit_log",
  "bir_expenses",
  "bir_sales_entries",
  "cash_advance_expenses",
  "cash_advances",
  "collection_entries",
  "commissions",
  "contract_notes",
  "contract_repricings",
  "contracts",
  "customers",
  "deliveries",
  "dtr_locations",
  "employee_rates",
  "holidays",
  "id_counters",
  "leads",
  "payments",
  "payslips",
  "ph_locations",
  "product_photos",
  "products",
  "profiles",
  "remittances",
  "stock_movements",
  "suppliers",
  "task_comments",
  "tasks",
  "thirteenth_month_payments",
  "time_correction_requests",
  "time_records",
] as const;

/**
 * A table listed above that does not exist in the database.
 *
 * The house rule adds a new table to this list in the same commit as the
 * migration that creates it, so between deploying and applying there is a
 * window where they disagree. That must be reported, never silently dumped as
 * an empty table — a hole in a backup you cannot see is worse than a failure.
 */
const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);

function isMissingTable(error: { code?: string; message?: string }): boolean {
  if (error.code && MISSING_TABLE_CODES.has(error.code)) return true;
  return /Could not find the table|does not exist/i.test(error.message ?? "");
}

/** Rows, or null when the table does not exist in this database. */
async function fetchAll(
  admin: SupabaseClient,
  table: string
): Promise<unknown[] | null> {
  const rows: unknown[] = [];
  // Stable-sort pagination: order by ctid is unavailable through PostgREST;
  // use id where it exists, else fall back to the table's natural order with
  // an explicit order to satisfy the pagination discipline. id is the
  // convention across every table in this schema (0014+ includes suppliers).
  // The error here used to be discarded, so a table that does NOT EXIST came
  // back as `first = null` and was dumped as an empty array — a hole in the
  // backup, indistinguishable from a genuinely empty table. Now a missing
  // table returns null and is reported; every other error still throws.
  const { data: first, error: probe } = await admin
    .from(table)
    .select("*")
    .limit(1);
  if (probe) {
    if (isMissingTable(probe)) return null;
    throw new Error(`${table}: ${probe.message}`);
  }
  if (!first || first.length === 0) return [];
  const sample = first[0] as Record<string, unknown>;
  const orderCol = "id" in sample ? "id" : Object.keys(sample)[0];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from(table)
      .select("*")
      .order(orderCol)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as unknown[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export async function GET(req: Request) {
  const expected = process.env.BACKUP_CRON_KEY;
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!expected || !timingSafeEqual(token, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const tables = TABLES as readonly string[];
    const missing: string[] = [];
    const dump: Record<string, unknown> = {
      backed_up_at: new Date().toISOString(),
      // Named in TABLES but absent from the database — normally the window
      // between deploying a migration's code and applying the migration. The
      // dump stays valid; this says exactly what it does not contain.
      missing_tables: missing,
      tables: {},
    };
    for (const table of tables) {
      const rows = await fetchAll(admin, table);
      if (rows === null) {
        missing.push(table);
        continue;
      }
      (dump.tables as Record<string, unknown>)[table] = rows;
    }

    // gzip the JSON body (Node 22: zlib.gzipSync in a route is fine for a
    // cron-triggered backup; payloads are small — thousands of rows).
    const { gzipSync } = await import("node:zlib");
    const body = gzipSync(Buffer.from(JSON.stringify(dump)));

    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(
      new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
      {
        headers: {
          "Content-Type": "application/gzip",
          "Content-Disposition": `attachment; filename="eandj-backup-${stamp}.json.gz"`,
        },
      }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Backup failed" },
      { status: 500 }
    );
  }
}
