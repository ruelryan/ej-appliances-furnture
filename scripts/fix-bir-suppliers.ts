/**
 * Correct supplier VAT status from the Expenses tab, and merge duplicate TINs.
 *
 *   npx tsx scripts/fix-bir-suppliers.ts --file <sales-workbook.xlsx>
 *   npx tsx scripts/fix-bir-suppliers.ts --file <...> --apply
 *
 * Dry run by default, `--apply` to write, report first.
 *
 * ── Why the VAT flag needed correcting ────────────────────────
 *
 * import-bir-expenses.ts set `vat_registered` from "did this supplier ever have
 * a row under TOTAL AMOUNT PAID (VAT)". That is too loose: 23 suppliers have
 * amounts in BOTH the VAT and non-VAT columns, so a single stray row flipped
 * them. Ryan caught it on Jash Marketing, which carries ₱66,700 under VAT
 * against ₱629,932 under non-VAT and is not VAT-registered.
 *
 * The rule here is the PREDOMINANT column by amount across the whole Expenses
 * tab (2021 onwards, 184 suppliers) rather than the 2024+ slice the importer
 * saw. A supplier is either registered or not; the occasional row in the other
 * column is a recording artefact, and the weight of the money says which is
 * which. Every supplier that uses both columns is listed in the report so the
 * office can overrule the heuristic — it is a reading of the evidence, not a
 * fact the sheet states outright.
 *
 * ── Merging ───────────────────────────────────────────────────
 *
 * A TIN identifies a taxpayer, so two supplier rows sharing one are the same
 * business entered twice. Both live cases are plain typos: E** GASOLINE STATION
 * beside EMIRATES GASOLINE STATION, and OPRA beside APRA TRADING. The survivor
 * is the one carrying more expense rows; ties keep the longer name, on the
 * grounds that the truncated spelling is the mistake.
 *
 * Merging repoints `bir_expenses.supplier_id` and then DELETES the duplicate —
 * the same shape as `merge_products` (0024), and equally irreversible. Rows
 * with no TIN are never merged: absence of a TIN is not evidence of sameness.
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
const fileArg = process.argv.indexOf("--file");
const FILE = fileArg > -1 ? process.argv[fileArg + 1] : "";
if (!FILE) {
  console.error("Usage: npx tsx scripts/fix-bir-suppliers.ts --file <sales-workbook.xlsx> [--apply]");
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

const norm = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const money = (v: unknown) => Number(String(v ?? "0").replace(/[, ₱]/g, "")) || 0;
const peso = (n: number) => n.toLocaleString("en-PH", { minimumFractionDigits: 2 });

function loadWorkbook(src: string): XLSX.WorkBook {
  if (/\.(json|txt)$/i.test(src)) {
    const payload = JSON.parse(fs.readFileSync(src, "utf8"));
    return XLSX.read(Buffer.from(payload.content, "base64"), { type: "buffer" });
  }
  return XLSX.readFile(src);
}

interface SheetSupplier { name: string; vat: number; non: number; tin: string; }

async function main() {
  const wb = loadWorkbook(FILE);
  const sheetTab = wb.Sheets["Expenses"];
  if (!sheetTab) {
    throw new Error(`no "Expenses" tab — this workbook has: ${wb.SheetNames.join(" | ")}`);
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheetTab, { header: 1, raw: false, defval: "" });
  const ix: Record<string, number> = {};
  (rows[1] as unknown[]).forEach((c, i) => {
    const k = String(c).trim();
    if (k && !(k in ix)) ix[k] = i;
  });

  const sheet = new Map<string, SheetSupplier>();
  for (const r of rows.slice(2)) {
    const nm = String(r[ix["NAME & ADDRESS OF SUPPLIERS"]] ?? "").trim();
    if (!nm || !String(r[ix["DATE"]] ?? "").trim()) continue;
    const k = norm(nm);
    const e = sheet.get(k) ?? { name: nm, vat: 0, non: 0, tin: "" };
    const t = String(r[ix["VAT REG NO./TIN"]] ?? "").trim();
    if (t && t !== "-" && !e.tin) e.tin = t;
    e.vat += money(r[ix["TOTAL AMOUNT PAID (VAT)"]]);
    e.non += money(r[ix["TOTAL AMOUNT PAID (NON VAT)"]]);
    sheet.set(k, e);
  }
  console.log(`${path.basename(FILE)} — Expenses tab: ${sheet.size} suppliers\n`);

  const db = await connect();
  const { rows: app } = await db.query(
    "select id, name, tin, vat_registered from public.suppliers order by name"
  );
  const { rows: usage } = await db.query(
    `select supplier_id, count(*)::int n from public.bir_expenses
      where voided_at is null and supplier_id is not null group by supplier_id`
  );
  const used = new Map<string, number>(usage.map((u) => [u.supplier_id, u.n]));

  // ── VAT status ──────────────────────────────────────────────
  const flips: { id: string; name: string; from: boolean; to: boolean; vat: number; non: number }[] = [];
  const mixed: string[] = [];
  for (const s of app) {
    const e = sheet.get(norm(s.name));
    if (!e) continue;
    if (e.vat > 0 && e.non > 0) {
      mixed.push(`   ${s.name.slice(0, 34).padEnd(34)} VAT ${peso(e.vat).padStart(13)}   non-VAT ${peso(e.non).padStart(13)}  -> ${e.vat > e.non ? "VAT" : "non-VAT"}`);
    }
    const should = e.vat > e.non;
    if (should !== s.vat_registered) {
      flips.push({ id: s.id, name: s.name, from: s.vat_registered, to: should, vat: e.vat, non: e.non });
    }
  }

  console.log(`VAT status to change: ${flips.length} of ${app.length}`);
  flips.forEach((f) =>
    console.log(`   ${f.name.slice(0, 34).padEnd(34)} ${f.from ? "VAT" : "non-VAT"} -> ${f.to ? "VAT" : "non-VAT"}   (VAT ${peso(f.vat)} / non-VAT ${peso(f.non)})`)
  );
  if (mixed.length) {
    console.log(`\nsuppliers using BOTH columns — the heuristic decided these, check them: ${mixed.length}`);
    mixed.slice(0, 12).forEach((m) => console.log(m));
    if (mixed.length > 12) console.log(`   … and ${mixed.length - 12} more`);
  }

  // ── Duplicate TINs ──────────────────────────────────────────
  const byTin = new Map<string, typeof app>();
  for (const s of app) {
    const t = String(s.tin ?? "").trim();
    if (!t || t === "-") continue; // no TIN is not evidence of sameness
    if (!byTin.has(t)) byTin.set(t, []);
    byTin.get(t)!.push(s);
  }
  const merges: { keep: (typeof app)[number]; drop: (typeof app)[number][]; tin: string }[] = [];
  for (const [tin, list] of byTin) {
    if (list.length < 2) continue;
    const ranked = [...list].sort(
      (a, b) => (used.get(b.id) ?? 0) - (used.get(a.id) ?? 0) || b.name.length - a.name.length
    );
    merges.push({ keep: ranked[0], drop: ranked.slice(1), tin });
  }

  console.log(`\nduplicate TINs to merge: ${merges.length}`);
  merges.forEach((m) => {
    console.log(`   ${m.tin}`);
    console.log(`      keep  ${m.keep.name}  (${used.get(m.keep.id) ?? 0} rows)`);
    m.drop.forEach((d) => console.log(`      merge ${d.name}  (${used.get(d.id) ?? 0} rows)`));
  });

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

  for (const f of flips) {
    await db.query("update public.suppliers set vat_registered = $2 where id = $1", [f.id, f.to]);
  }

  let moved = 0;
  for (const m of merges) {
    for (const d of m.drop) {
      const res = await db.query(
        "update public.bir_expenses set supplier_id = $1 where supplier_id = $2",
        [m.keep.id, d.id]
      );
      moved += res.rowCount ?? 0;
      await db.query("delete from public.suppliers where id = $1", [d.id]);
    }
  }
  await db.query("commit");

  const { rows: [after] } = await db.query(
    `select count(*)::int n,
            count(*) filter (where vat_registered)::int vat
       from public.suppliers`
  );
  console.log(`\n✅ VAT status corrected on ${flips.length}; merged ${merges.reduce((t, m) => t + m.drop.length, 0)} duplicate(s), repointing ${moved} expense row(s).`);
  console.log(`suppliers now: ${after.n} (${after.vat} VAT-registered)`);
  await db.end();
}

main().catch((e) => {
  console.error(`\n❌ ${e.message ?? e}`);
  process.exit(1);
});
