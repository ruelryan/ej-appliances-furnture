/**
 * The sales book starts in 2024, when the store became VAT-registered.
 *
 *   npx tsx scripts/fix-bir-sales-2024-start.ts
 *   npx tsx scripts/fix-bir-sales-2024-start.ts --apply
 *
 * Dry run by default, `--apply` to write, report first — the house pattern.
 *
 * ── Why ───────────────────────────────────────────────────────
 *
 * scripts/import-bir-sales.ts backfilled the sales book from the Sheet's
 * Contracts Database, which carries a Sales OR going back to 2023. Ryan then
 * said the store became VAT-registered in 2024 (2026-08-31), so 64 of those
 * 429 entries are dated before there was a VAT registration to declare them
 * under. They are not part of a Summary List of Sales and must come out.
 *
 * They are CANCELLED, not deleted. bir_sales_entries has no delete policy at
 * all (0041), cancelling keeps the audit trail and an audit_row_changes entry,
 * and the contracts return to the not-yet-booked queue on /bir/sales — which
 * is the truthful place for a sale that was never declared under VAT.
 *
 * Writes through cancel_sale_entry while impersonating a real owner inside one
 * transaction, so can_manage_bir() and the "already cancelled" guard apply
 * exactly as they do in the browser.
 */
import pg from "pg";
import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

// `pg` hands back a date column as a JS Date in the machine's local zone,
// which shifts the day and breaks every string comparison. Keep them strings.
pg.types.setTypeParser(1082, (v) => v);

const APPLY = process.argv.includes("--apply");

/** The first day the store was VAT-registered. Everything before it belongs to
 *  the pre-VAT regime and has no place in a VAT sales book. */
const VAT_START = "2024-01-01";
const REASON = "Pre-VAT registration — store registered 2024";

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
      host: c.host, port: c.port, user: c.user, password,
      database: "postgres", ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    });
    try { await client.connect(); console.log(`Connected via ${c.host}\n`); return client; }
    catch (e) { last = e; try { await client.end(); } catch {} }
  }
  throw last;
}

const peso = (n: number) => n.toLocaleString("en-PH", { minimumFractionDigits: 2 });

async function main() {
  const db = await connect();

  const { rows: doomed } = await db.query(
    `select id, sales_date, invoice_no, branch, gross_snapshot, customer_name_snapshot
       from public.bir_sales_entries
      where cancelled_at is null
        and sales_date < $1
      order by sales_date, id`,
    [VAT_START]
  );

  const { rows: [before] } = await db.query(
    `select count(*)::int n, coalesce(sum(gross_snapshot), 0)::numeric total
       from public.bir_sales_entries where cancelled_at is null`
  );

  console.log(`live entries now            : ${before.n}  ${peso(Number(before.total))}`);
  console.log(`dated before ${VAT_START}   : ${doomed.length}  ${peso(
    doomed.reduce((t, r) => t + Number(r.gross_snapshot), 0)
  )}`);
  console.log(`would remain                : ${before.n - doomed.length}  ${peso(
    Number(before.total) - doomed.reduce((t, r) => t + Number(r.gross_snapshot), 0)
  )}\n`);

  if (!doomed.length) {
    console.log("Nothing to do — the book already starts in 2024.");
    await db.end();
    return;
  }

  const byYear = new Map<string, number>();
  for (const r of doomed) {
    const y = String(r.sales_date).slice(0, 4);
    byYear.set(y, (byYear.get(y) ?? 0) + 1);
  }
  console.log("by year:", [...byYear].map(([y, n]) => `${y}=${n}`).join("  "));
  console.log("\nfirst few to cancel:");
  doomed.slice(0, 6).forEach((r) =>
    console.log(
      `   ${r.sales_date}  inv ${String(r.invoice_no).padEnd(14)} ${String(
        r.customer_name_snapshot
      ).slice(0, 24).padEnd(24)} ${peso(Number(r.gross_snapshot)).padStart(12)}  ${r.branch}`
    )
  );

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to cancel these.");
    await db.end();
    return;
  }

  const { rows: [owner] } = await db.query(
    "select id, full_name from public.profiles where role = 'owner' and active limit 1"
  );
  if (!owner) throw new Error("No active owner to act as");

  console.log(`\nCancelling as ${owner.full_name}…`);
  await db.query("begin");
  await db.query("set local role authenticated");
  await db.query(
    "select set_config('request.jwt.claims', json_build_object('sub',$1::text,'role','authenticated')::text, true)",
    [owner.id]
  );

  let done = 0;
  const failed: string[] = [];
  for (const r of doomed) {
    await db.query("savepoint sp");
    try {
      await db.query("select public.cancel_sale_entry($1, $2)", [r.id, REASON]);
      await db.query("release savepoint sp");
      done++;
    } catch (e) {
      await db.query("rollback to savepoint sp");
      failed.push(`${r.invoice_no}: ${(e as Error).message.slice(0, 60)}`);
    }
  }
  await db.query("commit");

  if (failed.length) {
    console.log(`\n${failed.length} refused:`);
    failed.slice(0, 8).forEach((f) => console.log(`   ${f}`));
  }

  const { rows: [after] } = await db.query(
    `select count(*)::int n, coalesce(sum(gross_snapshot), 0)::numeric total
       from public.bir_sales_entries where cancelled_at is null`
  );
  const { rows: [stragglers] } = await db.query(
    `select count(*)::int n from public.bir_sales_entries
      where cancelled_at is null and sales_date < $1`,
    [VAT_START]
  );

  console.log(`\n✅ Cancelled ${done}.`);
  console.log(`live entries now : ${after.n}  ${peso(Number(after.total))}`);
  console.log(`still pre-2024   : ${stragglers.n}${stragglers.n === 0 ? "  ✅" : "  ❌"}`);
  await db.end();
}

main().catch((e) => {
  console.error(`\n❌ ${e.message ?? e}`);
  process.exit(1);
});
