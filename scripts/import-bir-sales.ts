/**
 * Import the sales book from the Sheet's "Contracts Database" tab.
 *
 *   npx tsx scripts/import-bir-sales.ts --file <contracts-database.csv>
 *   npx tsx scripts/import-bir-sales.ts --file <...> --apply
 *
 * Dry run by default, `--apply` to write, report before touching anything —
 * the house pattern for every one-off data script here.
 *
 * ── Why this tab and not the Sales Journal ────────────────────
 *
 * The Sales Journal has the rows a return is built from, but it identifies a
 * customer by NAME and AMOUNT with no contract number, so importing from it
 * means fuzzy matching. Tested against the real data that got 43 of 45, and
 * the two failures were the instructive kind: two contracts for "Nyve,
 * Amilita" at the same 14,900 (unresolvable by name), and a "Nunez, Sanny"
 * row declared at 29,900 against a contract of 26,900 (a real disagreement,
 * not a matching bug).
 *
 * The Contracts Database already carries the answer. Columns R-T — Sales OR,
 * Sales Date, Sales By — are where the office records that a contract went
 * into the book. That is an exact key on contract number, so this importer
 * guesses at nothing.
 *
 * ── What it writes ────────────────────────────────────────────
 *
 * Through `book_sale`, impersonating a real owner inside one transaction, so
 * every guard that applies in the browser applies here: the role check, the
 * cash_price snapshot, the branch derived from item_type, and the two unique
 * indexes (one booking per contract, one invoice number per branch). The
 * alternative — inserting rows with the service key, which bypasses RLS —
 * would reimplement all of that and get some of it subtly wrong.
 *
 * The amount is NEVER taken from the CSV. It is contracts.cash_price, read by
 * the RPC. Where the Sheet's own Cash Price disagrees, the row is reported and
 * skipped: that is a discrepancy for a person, not something to paper over.
 *
 * A repeated invoice number is reported but IMPORTED. 0042 removed the unique
 * index on it after this import found 28 legitimate repeats — one receipt
 * covering two contracts, and short booklet numbers recycling years apart.
 */
import fs from "node:fs";
import { parse } from "csv-parse/sync";
import pg from "pg";
import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

// `pg` returns a date column as a JS Date built in the machine's local zone,
// which both shifts the day and loses every string comparison against a CSV
// date. This made an earlier reconciliation believe all 6,009 payments were
// missing. Keep dates as the strings Postgres sent.
pg.types.setTypeParser(1082, (v) => v);

const APPLY = process.argv.includes("--apply");
const fileArg = process.argv.indexOf("--file");
const FILE = fileArg > -1 ? process.argv[fileArg + 1] : "";

if (!FILE) {
  console.error("Usage: npx tsx scripts/import-bir-sales.ts --file <contracts-database.csv> [--apply]");
  process.exit(1);
}

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

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** The Sheet writes dates several ways depending on the column and who typed
 *  it: "Aug 14, 2021", "8/14/2021", and occasionally an ISO string. */
function parseDate(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s*(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo) return `${m[3]}-${String(mo).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${String(+m[1]).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`;
  return null;
}

const money = (raw: string): number | null => {
  const n = Number((raw ?? "").replace(/[,\s₱]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Header lookup that tolerates spacing and case drift between exports. */
function pick(row: Record<string, string>, ...names: string[]): string {
  const keys = Object.keys(row);
  for (const want of names) {
    const k = keys.find(
      (x) => x.toLowerCase().replace(/[^a-z0-9]/g, "") === want.toLowerCase().replace(/[^a-z0-9]/g, "")
    );
    if (k) return (row[k] ?? "").trim();
  }
  return "";
}

interface Plan {
  contractNo: string;
  contractId: string;
  invoiceNo: string;
  salesDate: string;
  cashPrice: number;
  branch: string;
}

async function main() {
  const rows = parse(fs.readFileSync(FILE, "utf-8"), {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
  }) as Record<string, string>[];

  console.log(`${FILE}\n${rows.length} rows in the Contracts Database export\n`);

  const db = await connect();

  const live = new Map<string, { id: string; cash_price: number; branch: string; booked: boolean }>();
  const res = await db.query(
    `select contract_no, contract_id, cash_price, branch, booked
       from public.v_bir_sales_register`
  );
  for (const r of res.rows) {
    live.set(String(r.contract_no).trim(), {
      id: r.contract_id,
      cash_price: Number(r.cash_price),
      branch: r.branch,
      booked: r.booked,
    });
  }
  console.log(`${live.size} contracts in the app\n`);

  const plans: Plan[] = [];
  const noOr: string[] = [];
  const notFound: string[] = [];
  const already: string[] = [];
  const badDate: string[] = [];
  const priceMismatch: string[] = [];
  const dupInvoice: string[] = [];
  const seen = new Map<string, string>(); // branch|invoice -> contract_no

  for (const row of rows) {
    const contractNo = pick(row, "Contract ID", "Contract no", "Contract Number");
    if (!contractNo) continue;

    const invoiceNo = pick(row, "Sales OR", "Sales OR no", "SalesOR");
    if (!invoiceNo) { noOr.push(contractNo); continue; }

    const c = live.get(contractNo);
    if (!c) { notFound.push(`${contractNo} (OR ${invoiceNo})`); continue; }
    if (c.booked) { already.push(contractNo); continue; }

    // A BLANK Sales Date falls back to the contract date — the office recorded
    // the OR without the day, and the contract date is the honest stand-in.
    // A date that is PRESENT but unreadable is reported instead: silently
    // substituting a different date would move the sale into another period,
    // and a period is what a return covers.
    const rawSalesDate = pick(row, "Sales Date");
    const salesDate = rawSalesDate
      ? parseDate(rawSalesDate)
      : parseDate(pick(row, "Date"));
    if (!salesDate) {
      badDate.push(
        rawSalesDate
          ? `${contractNo}: Sales Date "${rawSalesDate}" is unreadable`
          : `${contractNo}: no Sales Date and no usable contract Date`
      );
      continue;
    }

    // The Sheet's own Cash Price against the app's. The app's wins — the RPC
    // reads it — but a disagreement means one of the two records is wrong and
    // that is a person's call, not an importer's.
    const sheetPrice = money(pick(row, "Cash Price", "Cash Prize", "Price"));
    if (sheetPrice !== null && Math.abs(sheetPrice - c.cash_price) > 0.01) {
      priceMismatch.push(
        `${contractNo}: sheet ${sheetPrice.toLocaleString()} vs app ${c.cash_price.toLocaleString()}`
      );
      continue;
    }

    // A repeated number is reported, NOT skipped. 0042 removed the unique
    // index because the real history breaks it two legitimate ways: one
    // receipt covering two contracts for the same customer on the same day,
    // and short booklet numbers recycling when a new booklet is issued.
    const key = `${c.branch}|${invoiceNo}`;
    if (seen.has(key)) {
      dupInvoice.push(`${invoiceNo} in the ${c.branch} book: ${seen.get(key)} and ${contractNo}`);
    } else {
      seen.set(key, contractNo);
    }

    plans.push({
      contractNo, contractId: c.id, invoiceNo, salesDate,
      cashPrice: c.cash_price, branch: c.branch,
    });
  }

  const report = (title: string, list: string[], show = 8) => {
    if (!list.length) return;
    console.log(`${title}: ${list.length}`);
    list.slice(0, show).forEach((l) => console.log(`   ${l}`));
    if (list.length > show) console.log(`   … and ${list.length - show} more`);
    console.log();
  };

  console.log("──────── plan ────────");
  console.log(`to import           : ${plans.length}`);
  const total = plans.reduce((t, p) => t + p.cashPrice, 0);
  console.log(`declared value      : ${total.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`);
  for (const b of ["appliances", "furniture"]) {
    const n = plans.filter((p) => p.branch === b);
    console.log(`  ${b.padEnd(11)}: ${String(n.length).padStart(4)} entries, ${n
      .reduce((t, p) => t + p.cashPrice, 0)
      .toLocaleString("en-PH", { minimumFractionDigits: 2 })}`);
  }
  console.log();
  report("no Sales OR (not declared)", noOr, 4);
  report("already booked in the app", already, 4);
  report("contract not in the app", notFound);
  report("unreadable Sales Date", badDate);
  report("cash price disagrees — SKIPPED", priceMismatch);
  report("invoice number used twice — imported, worth a look", dupInvoice);

  if (plans.length) {
    console.log("first few to import:");
    plans.slice(0, 5).forEach((p) =>
      console.log(`   ${p.contractNo}  OR ${p.invoiceNo}  ${p.salesDate}  ${p.branch}  ${p.cashPrice.toLocaleString()}`)
    );
    console.log();
  }

  if (!APPLY) {
    console.log("DRY RUN — nothing written. Re-run with --apply to write.");
    await db.end();
    return;
  }

  const owner = (
    await db.query("select id, full_name from public.profiles where role='owner' and active limit 1")
  ).rows[0];
  if (!owner) throw new Error("No active owner to book as");

  console.log(`Writing as ${owner.full_name}…\n`);
  await db.query("begin");
  await db.query("set local role authenticated");
  await db.query(
    "select set_config('request.jwt.claims', json_build_object('sub',$1::text,'role','authenticated')::text,true)",
    [owner.id]
  );

  let done = 0;
  const failed: string[] = [];
  for (const p of plans) {
    await db.query("savepoint sp");
    try {
      await db.query("select public.book_sale($1,$2,$3::date,$4)", [
        p.contractId, p.invoiceNo, p.salesDate, "Imported from the Contracts Database",
      ]);
      await db.query("release savepoint sp");
      done++;
    } catch (e) {
      await db.query("rollback to savepoint sp");
      failed.push(`${p.contractNo} (OR ${p.invoiceNo}): ${(e as Error).message.slice(0, 70)}`);
    }
  }

  if (failed.length) {
    console.log(`\n${failed.length} row(s) refused by the database:`);
    failed.slice(0, 10).forEach((f) => console.log(`   ${f}`));
  }

  await db.query("commit");
  console.log(`\n✅ Booked ${done} sale(s).`);
  const after = await db.query("select count(*)::int n from public.bir_sales_entries where cancelled_at is null");
  console.log(`bir_sales_entries now holds ${after.rows[0].n} live entries.`);
  await db.end();
}

main().catch((e) => {
  console.error(`\n❌ ${e.message ?? e}`);
  process.exit(1);
});
