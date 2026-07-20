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

/**
 * The Sheet lists the chartered cities by bare name, but everyone — including
 * the customers writing their own addresses — says "Maasin City". Storing the
 * official name makes those exact matches instead of fuzzy ones.
 */
const CITY_NAMES: Record<string, string> = {
  Maasin: "Maasin City",
  Baybay: "Baybay City",
  Ormoc: "Ormoc City",
  Tacloban: "Tacloban City",
};
const officialName = (m: string) => CITY_NAMES[m] ?? m;

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
  const municipality = officialName(cell(muniRow, c));
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

/**
 * Municipalities absent from the Sheet's coverage tab but present in customer
 * addresses. Tacloban City is a highly urbanised city, administratively
 * independent of Leyte province, which is why it is not in the delivery grid.
 *
 * Its barangays are officially NUMBERED; locals use names — "Apitong" is
 * Barangay 92, corroborated by a customer address reading "Mount Side Charity
 * Lane, Apitong" against a published "Mountain Side Subdivision, Brgy. 92
 * Apitong". Source: philatlas.com, count 138 matching the PSA figure. Note the
 * sequence has gaps (no 1, 3, 4, 9, 10, 11) — historical merges, unverified —
 * so treat this list as good-enough-for-matching rather than authoritative.
 */
const EXTRA: Array<{ province: string; municipality: string; barangays: string[] }> = [
  {
    province: "Leyte",
    municipality: "Tacloban City",
    barangays: [
      ...["2", "5", "5-A", "6", "6-A", "7", "8", "8-A", "12", "13", "14", "15", "16", "17",
        "18", "19", "20", "21", "21-A", "22", "23", "23-A", "24", "25", "26", "27", "28",
        "29", "30", "31", "32", "33", "34", "35", "35-A", "36", "36-A", "37", "37-A", "38",
        "39", "40", "41", "42", "42-A", "43", "43-A", "43-B", "44", "44-A", "45", "46",
        "47", "48", "48-A", "48-B", "49", "50", "50-A", "50-B", "51", "51-A", "52", "53",
        "54", "54-A", "56", "56-A", "57", "58", "59", "59-A", "59-B", "60", "60-A", "61",
        "62", "62-A", "62-B", "63", "64", "65", "66", "66-A", "67", "68", "69", "70", "71",
        "72", "73", "74", "75", "76", "77", "78", "79", "80", "81", "82", "83", "83-A",
        "83-B", "83-C", "84", "85", "86", "87", "88", "89", "90", "91", "92", "93", "94",
        "94-A", "95", "95-A", "96", "97", "98", "99", "100", "101", "102", "103", "103-A",
        "104", "105", "106", "107", "108", "109", "109-A", "110"].map((n) => `Barangay ${n}`),
      "El Reposo", "Libertad", "Nula-tula",
    ],
  },
];

for (const e of EXTRA) {
  for (const b of e.barangays) {
    const key = `${e.province}|${e.municipality}|${b}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ province: e.province, municipality: e.municipality, barangay: b });
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
