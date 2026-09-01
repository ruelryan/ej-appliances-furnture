/**
 * Import expenses from the DETAILED "Expenses" tab, for dates the bookkeeper's
 * workbook has not reached yet.
 *
 *   npx tsx scripts/import-bir-expenses-detail.ts --file <sales-workbook.xlsx>
 *   npx tsx scripts/import-bir-expenses-detail.ts --file <...> --apply
 *   … --from 2026-07-01     (default: the day after the latest expense on file)
 *
 * Dry run by default, `--apply` to write, report first.
 *
 * ── Why a second importer ─────────────────────────────────────
 *
 * import-bir-expenses.ts reads the bookkeeper's workbook, which is the DECLARED
 * journal and is already split into APPLIANCES and FURNITURE tabs. It stops
 * where the bookkeeper stops — at Q2 2026, because no Q3 tab exists yet — which
 * left /bir showing July with sales and no purchases at all.
 *
 * This reads the office's own detailed Expenses tab, which runs to the present
 * but has no branch column. So the one thing this script must do that the other
 * does not is decide which book each row belongs to.
 *
 * ── How the branch is decided ─────────────────────────────────
 *
 * Ryan's rule (2026-09-01): "just separate the furniture supplier to the
 * furniture... gasoline and others are on appliances." So furniture goes to the
 * furniture book and everything else — fuel, rent, hardware, IT — to
 * appliances, which is also where the overhead already lives (0040).
 *
 * A supplier is treated as furniture when its NAME says so, or when every
 * expense already booked for it went to the furniture book. History alone is
 * not enough: several suppliers appear in both books historically, so a name
 * that plainly reads "furniture" has to win. Every assignment is printed, and
 * the report is the point — twelve suppliers is a list a person can check.
 *
 * ── Document type ─────────────────────────────────────────────
 *
 * This tab has no Official Receipt / Sales Invoice columns, so the type is
 * taken from what the same supplier's existing rows already carry. Where a
 * supplier is new, it is recorded as `none` rather than invented.
 */
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import pg from "pg";
import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
pg.types.setTypeParser(1082, (v) => v);

const APPLY = process.argv.includes("--apply");
const arg = (name: string): string => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : "";
};
const FILE = arg("--file");
const FROM_ARG = arg("--from");
if (!FILE) {
  console.error("Usage: npx tsx scripts/import-bir-expenses-detail.ts --file <workbook.xlsx> [--from YYYY-MM-DD] [--apply]");
  process.exit(1);
}

/** Names that mark a furniture supplier. Deliberately explicit rather than
 *  clever: the list is short, the report shows every decision, and a wrong
 *  guess here puts a purchase in the wrong VAT return. */
const FURNITURE_NAME = /FURNITURE|FURNISHING|WOODCRAFT|UPHOLSTER|FOAM|SALA SET/i;

const CATEGORY_MAP: Record<string, string> = {
  "OFFICE SUPPLES": "OFFICE SUPPLIES",
  "SALARIES, WAGES, ALLOWANCE": "SALARIES WAGES AND ALLOWANCE",
  "SSS, GSIS, PHILHEALTH": "SSS GSIS PHILHEALTH",
  "UTILITIES/LIGHTS AND WATER": "UTILITIES LIGHTS AND WATER",
  "TAXES AND LICENSES(2551/2550)": "TAXES AND LICENSES (2551/2550)",
  "ENTERTAINMENT, AMUSEMENT": "ENTERTAINMENT AND AMUSEMENT",
};

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

const money = (v: unknown) => Number(String(v ?? "0").replace(/[, ₱]/g, "")) || 0;
const norm = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const peso = (n: number) => n.toLocaleString("en-PH", { minimumFractionDigits: 2 });
const clean = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s && s !== "-" ? s : "";
};

function parseDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${String(+m[1]).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`;
  return null;
}

interface Row {
  date: string; supplier: string; docNo: string; tin: string; address: string;
  grossVat: number; grossNonVat: number; category: string;
  branch: string; why: string; docType: string;
}

function loadWorkbook(src: string): XLSX.WorkBook {
  if (/\.(json|txt)$/i.test(src)) {
    const payload = JSON.parse(fs.readFileSync(src, "utf8"));
    return XLSX.read(Buffer.from(payload.content, "base64"), { type: "buffer" });
  }
  return XLSX.readFile(src);
}

async function main() {
  const db = await connect();

  const { rows: [latest] } = await db.query(
    "select max(expense_date) d from public.bir_expenses where voided_at is null"
  );
  const from =
    FROM_ARG ||
    (latest.d
      ? new Date(new Date(`${latest.d}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10)
      : "2024-01-01");
  console.log(`${path.basename(FILE)}`);
  console.log(`latest expense on file: ${latest.d ?? "(none)"}  ->  importing from ${from}\n`);

  // What each supplier already tells us: which book, and which document type.
  const { rows: prior } = await db.query(
    `select supplier_name_snapshot, branch, doc_type, count(*)::int n
       from public.bir_expenses where voided_at is null
      group by 1,2,3`
  );
  const furHist = new Map<string, number>();
  const appHist = new Map<string, number>();
  const docHist = new Map<string, Map<string, number>>();
  for (const p of prior) {
    const k = norm(p.supplier_name_snapshot);
    (p.branch === "furniture" ? furHist : appHist).set(k, ((p.branch === "furniture" ? furHist : appHist).get(k) ?? 0) + p.n);
    if (!docHist.has(k)) docHist.set(k, new Map());
    const d = docHist.get(k)!;
    d.set(p.doc_type, (d.get(p.doc_type) ?? 0) + p.n);
  }

  const wb = loadWorkbook(FILE);
  const sheet = wb.Sheets["Expenses"];
  if (!sheet) throw new Error(`no "Expenses" tab — workbook has: ${wb.SheetNames.join(" | ")}`);
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
  const ix: Record<string, number> = {};
  (raw[1] as unknown[]).forEach((c, i) => {
    const k = String(c).trim();
    if (k && !(k in ix)) ix[k] = i;
  });

  const parsed: Row[] = [];
  const badCategory: string[] = [];
  for (const r of raw.slice(2)) {
    const date = parseDate(r[ix["DATE"]]);
    if (!date || date < from) continue;
    const supplier = clean(r[ix["NAME & ADDRESS OF SUPPLIERS"]]);
    if (!supplier) continue;
    const grossVat = money(r[ix["TOTAL AMOUNT PAID (VAT)"]]);
    const grossNonVat = money(r[ix["TOTAL AMOUNT PAID (NON VAT)"]]);
    if (grossVat <= 0 && grossNonVat <= 0) continue;

    const rawCat = clean(r[ix["CATEGORY"]]).toUpperCase();
    const category = CATEGORY_MAP[rawCat] ?? rawCat;
    if (!category) { badCategory.push(`${date} ${supplier.slice(0, 26)}`); continue; }

    const k = norm(supplier);
    let branch = "appliances";
    let why = "default — fuel, rent and everything else go to Appliances";
    if (FURNITURE_NAME.test(supplier)) {
      branch = "furniture"; why = "name says furniture";
    } else if ((furHist.get(k) ?? 0) > 0 && (appHist.get(k) ?? 0) === 0) {
      branch = "furniture"; why = "every past expense for them was furniture";
    }

    const d = docHist.get(k);
    const docType = d ? [...d.entries()].sort((a, b) => b[1] - a[1])[0][0] : "none";

    parsed.push({
      date, supplier, docNo: clean(r[ix["INVOICE #"]]), tin: clean(r[ix["VAT REG NO./TIN"]]),
      address: clean(r[ix["ADDRESS"]]), grossVat, grossNonVat, category, branch, why, docType,
    });
  }

  console.log(`rows to import: ${parsed.length}   ${peso(parsed.reduce((t, r) => t + r.grossVat + r.grossNonVat, 0))}`);
  const byMonth = new Map<string, { n: number; t: number }>();
  for (const r of parsed) {
    const m = r.date.slice(0, 7);
    const e = byMonth.get(m) ?? { n: 0, t: 0 };
    e.n++; e.t += r.grossVat + r.grossNonVat;
    byMonth.set(m, e);
  }
  [...byMonth].sort().forEach(([m, e]) => console.log(`   ${m}  ${String(e.n).padStart(3)} rows  ${peso(e.t).padStart(13)}`));

  console.log("\nbranch decided per supplier:");
  const bySup = new Map<string, { name: string; n: number; t: number; branch: string; why: string }>();
  for (const r of parsed) {
    const k = norm(r.supplier);
    const e = bySup.get(k) ?? { name: r.supplier, n: 0, t: 0, branch: r.branch, why: r.why };
    e.n++; e.t += r.grossVat + r.grossNonVat;
    bySup.set(k, e);
  }
  [...bySup.values()].sort((a, b) => b.t - a.t).forEach((s) =>
    console.log(`   ${s.branch === "furniture" ? "FURNITURE " : "appliances"}  ${s.name.slice(0, 34).padEnd(34)} ${String(s.n).padStart(2)} rows ${peso(s.t).padStart(12)}   ${s.why}`)
  );
  for (const b of ["appliances", "furniture"]) {
    const g = parsed.filter((r) => r.branch === b);
    console.log(`   -> ${b.padEnd(11)} ${String(g.length).padStart(3)} rows  ${peso(g.reduce((t, r) => t + r.grossVat + r.grossNonVat, 0))}`);
  }
  if (badCategory.length) console.log(`\nblank category — SKIPPED: ${badCategory.length}`);

  const { rows: [clash] } = await db.query(
    "select count(*)::int n from public.bir_expenses where voided_at is null and expense_date >= $1",
    [from]
  );
  if (clash.n > 0) {
    console.log(`\n⚠ ${clash.n} expense row(s) already exist on or after ${from}. Refusing — that would double-count.`);
    await db.end();
    return;
  }

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to write.");
    await db.end();
    return;
  }

  const { rows: [owner] } = await db.query(
    "select id, full_name from public.profiles where role='owner' and active limit 1"
  );
  if (!owner) throw new Error("No active owner to act as");
  console.log(`\nWriting as ${owner.full_name}…`);

  await db.query("begin");
  await db.query("set local role authenticated");
  await db.query(
    "select set_config('request.jwt.claims', json_build_object('sub',$1::text,'role','authenticated')::text,true)",
    [owner.id]
  );

  const { rows: sup } = await db.query("select id, name from public.suppliers");
  const supId = new Map<string, string>(sup.map((s) => [norm(s.name), s.id]));

  let made = 0;
  for (const r of parsed) {
    const k = norm(r.supplier);
    if (supId.has(k)) continue;
    const { rows: [s] } = await db.query(
      "select public.upsert_bir_supplier(null,$1,$2,$3,$4,null) as id",
      [r.supplier, r.address || null, r.tin || null, r.grossVat > 0]
    );
    supId.set(k, s.id);
    made++;
  }
  if (made) console.log(`suppliers created: ${made}`);

  let done = 0;
  const failed: string[] = [];
  for (const r of parsed) {
    await db.query("savepoint sp");
    try {
      await db.query(
        "select public.record_bir_expense($1::date,$2,$3,$4,$5,$6::numeric,$7::numeric,$8,$9,$10)",
        [r.date, supId.get(norm(r.supplier)) ?? null, r.supplier, r.docType, r.docNo || null,
         r.grossVat, r.grossNonVat, r.category, r.branch,
         "Imported from the detailed Expenses tab"]
      );
      await db.query("release savepoint sp");
      done++;
    } catch (e) {
      await db.query("rollback to savepoint sp");
      failed.push(`${r.date} ${r.supplier.slice(0, 24)}: ${(e as Error).message.slice(0, 60)}`);
    }
  }
  await db.query("commit");

  if (failed.length) {
    console.log(`\n${failed.length} refused:`);
    failed.slice(0, 8).forEach((f) => console.log(`   ${f}`));
  }
  const { rows: [after] } = await db.query(
    `select count(*)::int n, coalesce(sum(total),0)::numeric t, max(expense_date) d
       from public.bir_expenses where voided_at is null`
  );
  console.log(`\n✅ Recorded ${done}. bir_expenses now ${after.n} rows, ${peso(Number(after.t))}, latest ${after.d}`);
  await db.end();
}

main().catch((e) => {
  console.error(`\n❌ ${e.message ?? e}`);
  process.exit(1);
});
