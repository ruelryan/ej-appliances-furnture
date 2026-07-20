/**
 * Seeds public.ph_locations from the Sheet's "Delivery Locations" tab — the
 * barangays E & J actually delivers to.
 *
 *   npx tsx scripts/import-locations.ts --file <workbook.xlsx>          # dry run
 *   npx tsx scripts/import-locations.ts --file <workbook.xlsx> --load
 *
 * The tab is a WIDE pivot, not a list: row 2 holds the province per column,
 * row 3 the municipality, and the barangays run down each column from row 5.
 * Columns are read by position because that is the shape of the sheet; the
 * header rows are located by content so an inserted row at the top won't
 * silently shift everything.
 */
import fs from "node:fs";
import * as XLSX from "xlsx";
import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const args = process.argv.slice(2);
const file = args[args.indexOf("--file") + 1];
const load = args.includes("--load");
if (!file || args.indexOf("--file") < 0) {
  console.error("Usage: --file <workbook.xlsx> [--load]");
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error(`Not found: ${file}`);
  process.exit(1);
}

const wb = XLSX.readFile(file);
const ws = wb.Sheets["Delivery Locations"];
if (!ws) {
  console.error(`No "Delivery Locations" tab. Found: ${wb.SheetNames.join(" | ")}`);
  process.exit(1);
}
const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

const cell = (r: number, c: number) => String(rows[r]?.[c] ?? "").trim();
const findRow = (label: string) =>
  rows.findIndex((r) => String(r?.[0] ?? "").trim().toLowerCase() === label);

const provRow = findRow("province");
const muniRow = findRow("municipality");
const bgyRow = findRow("barangays");
if (provRow < 0 || muniRow < 0 || bgyRow < 0) {
  console.error('Could not find the "Province" / "Municipality" / "Barangays" label rows in column A.');
  process.exit(1);
}

const width = Math.max(...rows.map((r) => r.length));
const out: Array<{ province: string; municipality: string; barangay: string }> = [];
const seen = new Set<string>();
let dupes = 0;

for (let c = 1; c < width; c++) {
  const municipality = cell(muniRow, c);
  if (!municipality) continue;
  const province = cell(provRow, c);
  if (!province) {
    console.warn(`  ! column ${c} (${municipality}) has no province — skipped`);
    continue;
  }
  for (let r = bgyRow; r < rows.length; r++) {
    const barangay = cell(r, c);
    if (!barangay) continue;
    const key = `${province}|${municipality}|${barangay}`.toLowerCase();
    if (seen.has(key)) { dupes++; continue; }
    seen.add(key);
    out.push({ province, municipality, barangay });
  }
}

const byProvince = new Map<string, Set<string>>();
for (const r of out) {
  if (!byProvince.has(r.province)) byProvince.set(r.province, new Set());
  byProvince.get(r.province)!.add(r.municipality);
}
console.log(`Parsed ${out.length} barangays${dupes ? ` (${dupes} duplicate rows ignored)` : ""}`);
for (const [p, munis] of byProvince) {
  const n = out.filter((r) => r.province === p).length;
  console.log(`  ${p}: ${munis.size} municipalities, ${n} barangays`);
}

if (!load) {
  console.log("\nSample:");
  for (const r of out.slice(0, 5)) console.log(`  ${r.barangay}, ${r.municipality}, ${r.province}`);
  console.log("\nDry run. Re-run with --load to seed the table.");
  process.exit(0);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const password = process.env.SUPABASE_DB_PASSWORD;
if (!url || !password) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_DB_PASSWORD in .env.local");
  process.exit(1);
}
const ref = new URL(url).hostname.split(".")[0];

async function main() {
  const pg = new Client({
    host: "aws-1-ap-south-1.pooler.supabase.com",
    port: 5432,
    user: `postgres.${ref}`,
    password,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
  await pg.connect();

  // Idempotent: the unique triple makes re-running a no-op rather than a
  // duplicate. Existing customer addresses reference these by VALUE, not by id,
  // so re-seeding never orphans anything.
  let inserted = 0;
  for (let i = 0; i < out.length; i += 200) {
    const batch = out.slice(i, i + 200);
    const vals = batch.map((_, j) => `($${j * 3 + 1}, $${j * 3 + 2}, $${j * 3 + 3})`).join(",");
    const params = batch.flatMap((r) => [r.province, r.municipality, r.barangay]);
    const res = await pg.query(
      `insert into public.ph_locations (province, municipality, barangay)
       values ${vals}
       on conflict (province, municipality, barangay) do nothing`,
      params
    );
    inserted += res.rowCount ?? 0;
  }

  const { rows: tally } = await pg.query(
    `select province, count(distinct municipality)::int municipalities, count(*)::int barangays
       from public.ph_locations group by province order by province`
  );
  console.log(`\nInserted ${inserted} new row(s). Table now holds:`);
  for (const t of tally) {
    console.log(`  ${t.province}: ${t.municipalities} municipalities, ${t.barangays} barangays`);
  }

  await pg.end();
}

main();
