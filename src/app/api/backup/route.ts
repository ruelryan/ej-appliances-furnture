import { createClient as createSupabaseClient } from "@supabase/supabase-js";
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

async function listTables(): Promise<string[]> {
  // PostgREST exposes the schema descriptor at GET /rest/v1/. Parse the
  // paths (one per table/view) so the backup list never drifts from the
  // migrations. Filter out parameterized routes like /{table}.
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${base}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`schema discovery failed: ${res.status}`);
  const spec = (await res.json()) as {
    paths?: Record<string, { get?: { summary?: string } }>;
  };
  return Object.keys(spec.paths ?? {})
    .map((p) => p.replace(/^\//, ""))
    .filter((name) => !name.includes("{")) // skip parameterized routes
    .sort();
}

async function fetchAll(
  admin: ReturnType<typeof createSupabaseClient>,
  table: string
): Promise<unknown[]> {
  const rows: unknown[] = [];
  // Stable-sort pagination: order by ctid is unavailable through PostgREST;
  // use id where it exists, else fall back to the table's natural order with
  // an explicit order to satisfy the pagination discipline. id is the
  // convention across every table in this schema (0014+ includes suppliers).
  const { data: first } = await admin.from(table).select("*").limit(1);
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
    const tables = await listTables(admin);
    const dump: Record<string, unknown> = {
      backed_up_at: new Date().toISOString(),
      tables: {},
    };
    for (const table of tables) {
      const rows = await fetchAll(admin, table);
      (dump.tables as Record<string, unknown>)[table] = rows;
    }

    // gzip the JSON body (Node 22: zlib.gzipSync in a route is fine for a
    // cron-triggered backup; payloads are small — thousands of rows).
    const { gzipSync } = await import("node:zlib");
    const body = gzipSync(Buffer.from(JSON.stringify(dump)));

    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="eandj-backup-${stamp}.json.gz"`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Backup failed" },
      { status: 500 }
    );
  }
}
