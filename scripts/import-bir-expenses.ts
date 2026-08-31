/**
 * Import the purchase journal from the bookkeeper's workbook.
 *
 *   npx tsx scripts/import-bir-expenses.ts --file <bir.xlsx | drive-download.json>
 *   npx tsx scripts/import-bir-expenses.ts --file <...> --apply
 *
 * Dry run by default, `--apply` to write, report first — the house pattern.
 *
 * ── Which tabs, and why not the others ────────────────────────
 *
 * The workbook "E & J APPLIANCES (BIR)" has 57 tabs. Only the 28 named
 * `Q<n> <year> Exp APPLIANCES` / `… FURNITURE` are the declared purchase
 * journal, and they are already split by registration. The rest were examined
 * and excluded on evidence, not by guessing:
 *
 *   Cost of Sales APP/FUR (11 tabs)  ~1,000 rows each but NO purchase-journal
 *                                    header — a different layout entirely.
 *   Detail2-COST OF SALES            46 rows, and all 46 already appear in an
 *                                    Exp tab. A breakdown, not extra rows.
 *   Q1–Q4 EXPENSES (4 tabs)          every row dated 2022, pre-VAT, and no
 *                                    branch on the tab name.
 *   Inv …, Detail3/4-TAXES …         not expense layouts.
 *
 * ── 2024 onwards ──────────────────────────────────────────────
 *
 * The store became VAT-registered in 2024 (Ryan, 2026-08-31), and the sales
 * book already starts there. A purchase journal exists to support input-tax
 * credits, so a 2023 row in it would claim a credit that did not exist.
 *
 * ── Document type is read, not assumed ────────────────────────
 *
 * The 2024+ tabs carry two extra columns, "Official Receipt" and "Sales
 * Invoice". They are NOT per-row flags — they hold supplier NAMES, a side list
 * of which supplier issues which document. Read as sets they classify 98 of the
 * 109 suppliers used (902 of 915 rows); anything unlisted is recorded as
 * `none` rather than being invented.
 *
 * ── The money is never recomputed here ────────────────────────
 *
 * record_bir_expense derives the VAT split in SQL from the gross. This script
 * checks the sheet's own VATABLE PURCHASES / VAT INPUT TAX against that
 * derivation and reports any disagreement — on the 2024+ rows it agrees on all
 * 791 that carry input tax, which is what makes the import trustworthy.
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
const FORCE = process.argv.includes("--force");
const fileArg = process.argv.indexOf("--file");
const FILE = fileArg > -1 ? process.argv[fileArg + 1] : "";
if (!FILE) {
  console.error("Usage: npx tsx scripts/import-bir-expenses.ts --file <bir.xlsx | drive-download.json> [--apply]");
  process.exit(1);
}

const FROM_YEAR = "2024";

/** The sheet's category spellings mapped onto the canonical list in
 *  src/lib/bir.ts (mirrored by the CHECK constraint in 0039). Four differ. */
const CATEGORY_MAP: Record<string, string> = {
  "OFFICE SUPPLES": "OFFICE SUPPLIES",
  "SALARIES, WAGES, ALLOWANCE": "SALARIES WAGES AND ALLOWANCE",
  "SSS, GSIS, PHILHEALTH": "SSS GSIS PHILHEALTH",
  "UTILITIES/LIGHTS AND WATER": "UTILITIES LIGHTS AND WATER",
  "TAXES AND LICENSES(2551/2550)": "TAXES AND LICENSES (2551/2550)",
  "ENTERTAINMENT, AMUSEMENT": "ENTERTAINMENT AND AMUSEMENT",
  "CHARITABLE AND OTHERS": "CHARITABLE AND OTHERS",
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

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseDate(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${String(+m[1]).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`;
  m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s*(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo) return `${m[3]}-${String(mo).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`;
  }
  return null;
}

const money = (v: unknown): number => Number(String(v ?? "0").replace(/[, ₱]/g, "")) || 0;
const norm = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const peso = (n: number) => n.toLocaleString("en-PH", { minimumFractionDigits: 2 });
const clean = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s && s !== "-" ? s : "";
};

interface Row {
  date: string; branch: string; supplier: string; address: string; tin: string;
  docNo: string; docType: string; grossVat: number; grossNonVat: number;
  category: string; tab: string;
}

function loadWorkbook(src: string): XLSX.WorkBook {
  if (/\.(json|txt)$/i.test(src)) {
    const payload = JSON.parse(fs.readFileSync(src, "utf8"));
    return XLSX.read(Buffer.from(payload.content, "base64"), { type: "buffer" });
  }
  return XLSX.readFile(src);
}

async function main() {
  const wb = loadWorkbook(FILE);
  console.log(`${path.basename(FILE)}\n`);

  // Pass 1: the supplier -> document-type side lists.
  const ORs = new Set<string>();
  const SIs = new Set<string>();
  const tabs = wb.SheetNames.filter((n) => /^Q\d \d{4} Exp (APPLIANCES|FURNITURE)$/i.test(n));

  const parsed: Row[] = [];
  const badDate: string[] = [];
  const badCategory: string[] = [];
  const vatMismatch: string[] = [];

  for (const tab of tabs) {
    const year = tab.match(/ (\d{4}) /)![1];
    const branch = /APPLIANCES$/i.test(tab) ? "appliances" : "furniture";
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[tab], {
      header: 1, raw: false, defval: "",
    });
    const hi = rows.findIndex((r) => r.some((c) => /NAME & ADDRESS OF SUPPLIERS/i.test(String(c))));
    if (hi < 0) continue;
    const ix: Record<string, number> = {};
    (rows[hi] as unknown[]).forEach((c, i) => {
      const k = String(c).trim();
      if (k && !(k in ix)) ix[k] = i;
    });

    for (const r of rows.slice(hi + 1)) {
      const o = norm(r[ix["Official Receipt"]]);
      const s = norm(r[ix["Sales Invoice"]]);
      if (o) ORs.add(o);
      if (s) SIs.add(s);

      if (year < FROM_YEAR) continue;
      const rawDate = clean(r[ix["DATE"]]);
      if (!rawDate) continue;

      const date = parseDate(rawDate);
      if (!date) { badDate.push(`${tab}: "${rawDate}"`); continue; }

      const supplier = clean(r[ix["NAME & ADDRESS OF SUPPLIERS"]]);
      if (!supplier) continue;

      const grossVat = money(r[ix["TOTAL AMOUNT PAID (VAT)"]]);
      const grossNonVat = money(r[ix["TOTAL AMOUNT PAID (NON VAT)"]]);
      if (grossVat <= 0 && grossNonVat <= 0) continue;

      // The sheet's own split against the one SQL will derive.
      if (grossVat > 0) {
        const vatable = Math.round((grossVat / 1.12) * 100) / 100;
        const input = Math.round((grossVat - vatable) * 100) / 100;
        const sv = money(r[ix["VATABLE PURCHASES"]]);
        const si2 = money(r[ix["VAT INPUT TAX"]]);
        if (Math.abs(sv - vatable) > 0.02 || Math.abs(si2 - input) > 0.02) {
          vatMismatch.push(`${tab} ${date} ${supplier.slice(0, 20)}: sheet ${sv}/${si2} vs SQL ${vatable}/${input}`);
        }
      }

      const rawCat = clean(r[ix["CATEGORY"]]).toUpperCase();
      const category = CATEGORY_MAP[rawCat] ?? rawCat;
      if (!category) { badCategory.push(`${tab} ${date} ${supplier.slice(0, 24)}: (blank)`); continue; }

      parsed.push({
        date, branch, supplier,
        address: clean(r[ix["ADDRESS"]]),
        tin: clean(r[ix["VAT REG NO./TIN"]]),
        docNo: clean(r[ix["INVOICE #"]]),
        docType: "", // filled after both side lists are complete
        grossVat, grossNonVat, category, tab,
      });
    }
  }

  // Pass 2: classify the document type now that the side lists are whole.
  const noDocType: string[] = [];
  for (const r of parsed) {
    const n = norm(r.supplier);
    if (SIs.has(n)) r.docType = "sales_invoice";
    else if (ORs.has(n)) r.docType = "official_receipt";
    else { r.docType = "none"; noDocType.push(`${r.supplier} (${r.date})`); }
  }

  const db = await connect();

  const { rows: [existing] } = await db.query(
    `select count(*)::int n from public.bir_expenses
      where voided_at is null and expense_date >= $1`,
    [`${FROM_YEAR}-01-01`]
  );

  const byYear = new Map<string, { n: number; t: number }>();
  for (const r of parsed) {
    const y = r.date.slice(0, 4);
    const e = byYear.get(y) ?? { n: 0, t: 0 };
    e.n++; e.t += r.grossVat + r.grossNonVat;
    byYear.set(y, e);
  }

  console.log(`tabs read            : ${tabs.length}`);
  console.log(`rows from ${FROM_YEAR} onward : ${parsed.length}`);
  console.log(`total                : ${peso(parsed.reduce((t, r) => t + r.grossVat + r.grossNonVat, 0))}`);
  for (const y of [...byYear.keys()].sort()) {
    const e = byYear.get(y)!;
    console.log(`   ${y}  ${String(e.n).padStart(4)} rows  ${peso(e.t).padStart(14)}`);
  }
  for (const b of ["appliances", "furniture"]) {
    const g = parsed.filter((r) => r.branch === b);
    console.log(`   ${b.padEnd(11)} ${String(g.length).padStart(4)} rows  ${peso(g.reduce((t, r) => t + r.grossVat + r.grossNonVat, 0)).padStart(14)}`);
  }
  const docCount = (t: string) => parsed.filter((r) => r.docType === t).length;
  console.log(`\ndocument type: sales_invoice ${docCount("sales_invoice")}, official_receipt ${docCount("official_receipt")}, none ${docCount("none")}`);

  const report = (title: string, list: string[], n = 6) => {
    if (!list.length) return;
    console.log(`\n${title}: ${list.length}`);
    list.slice(0, n).forEach((l) => console.log(`   ${l}`));
    if (list.length > n) console.log(`   … and ${list.length - n} more`);
  };
  report("unreadable date — SKIPPED", badDate);
  report("blank category — SKIPPED", badCategory);
  report("sheet VAT split disagrees with SQL", vatMismatch);
  report("supplier not in either document list — recorded as 'none'", [...new Set(noDocType)]);

  if (existing.n > 0) {
    console.log(`\n⚠ ${existing.n} expense row(s) from ${FROM_YEAR} onward already exist.`);
    if (!FORCE) {
      console.log("   Refusing to import on top of them — that would double-count.");
      console.log("   Re-run with --force if you really mean to add these as well.");
      await db.end();
      return;
    }
  }

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to write.");
    await db.end();
    return;
  }

  // Suppliers first, so every expense can point at one.
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

  const existingSup = await db.query("select id, name from public.suppliers");
  const supId = new Map<string, string>(existingSup.rows.map((s) => [norm(s.name), s.id]));

  const wanted = new Map<string, { name: string; address: string; tin: string; vat: boolean }>();
  for (const r of parsed) {
    const k = norm(r.supplier);
    const w = wanted.get(k) ?? { name: r.supplier, address: "", tin: "", vat: false };
    if (!w.address && r.address) w.address = r.address;
    if (!w.tin && r.tin) w.tin = r.tin;
    if (r.grossVat > 0) w.vat = true;
    wanted.set(k, w);
  }

  let madeSup = 0;
  for (const [k, w] of wanted) {
    if (supId.has(k)) continue;
    const { rows: [s] } = await db.query(
      "select public.upsert_bir_supplier(null, $1, $2, $3, $4, null) as id",
      [w.name, w.address || null, w.tin || null, w.vat]
    );
    supId.set(k, s.id);
    madeSup++;
  }
  console.log(`suppliers created: ${madeSup} (${wanted.size} referenced)`);

  let done = 0;
  const failed: string[] = [];
  for (const r of parsed) {
    await db.query("savepoint sp");
    try {
      await db.query(
        "select public.record_bir_expense($1::date,$2,$3,$4,$5,$6::numeric,$7::numeric,$8,$9,$10)",
        [r.date, supId.get(norm(r.supplier)) ?? null, r.supplier, r.docType, r.docNo || null,
         r.grossVat, r.grossNonVat, r.category, r.branch,
         "Imported from the bookkeeper workbook"]
      );
      await db.query("release savepoint sp");
      done++;
    } catch (e) {
      await db.query("rollback to savepoint sp");
      failed.push(`${r.tab} ${r.date} ${r.supplier.slice(0, 22)}: ${(e as Error).message.slice(0, 60)}`);
    }
  }
  await db.query("commit");

  if (failed.length) {
    console.log(`\n${failed.length} row(s) refused by the database:`);
    failed.slice(0, 10).forEach((f) => console.log(`   ${f}`));
  }

  const { rows: [after] } = await db.query(
    `select count(*)::int n, coalesce(sum(total),0)::numeric t, coalesce(sum(vat_input_tax),0)::numeric v
       from public.bir_expenses where voided_at is null`
  );
  console.log(`\n✅ Recorded ${done} expense(s).`);
  console.log(`bir_expenses now: ${after.n} rows, ${peso(Number(after.t))}, input tax ${peso(Number(after.v))}`);
  await db.end();
}

main().catch((e) => {
  console.error(`\n❌ ${e.message ?? e}`);
  process.exit(1);
});
