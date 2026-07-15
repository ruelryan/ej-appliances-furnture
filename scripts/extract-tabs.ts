/**
 * Decodes a Drive download_file_content JSON result into an .xlsx and
 * extracts the migration tabs as CSVs.
 *   npx tsx scripts/extract-tabs.ts <download-result.json> <output-dir>
 */
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

const [jsonPath, outDir] = process.argv.slice(2);
if (!jsonPath || !outDir) {
  console.error("Usage: npx tsx scripts/extract-tabs.ts <download-result.json> <output-dir>");
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

const payload = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const xlsxPath = path.join(outDir, "eandj-sheet.xlsx");
fs.writeFileSync(xlsxPath, Buffer.from(payload.content, "base64"));
console.log(`Saved workbook: ${xlsxPath} (${payload.title})`);

const wb = XLSX.readFile(xlsxPath, { cellDates: false });
console.log("Tabs found:", wb.SheetNames.join(" | "));

const WANTED: Array<[tab: string, file: string]> = [
  ["Contracts Database", "contracts.csv"],
  ["Payments Database", "payments.csv"],
  ["Collection", "collection.csv"],
];

for (const [tab, file] of WANTED) {
  const ws = wb.Sheets[tab];
  if (!ws) {
    console.warn(`⚠️ Tab "${tab}" not found — skipped`);
    continue;
  }
  // sheet_to_csv emits formatted strings (dates/currency as displayed)
  const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
  fs.writeFileSync(path.join(outDir, file), csv, "utf8");
  const rows = csv.split("\n").length;
  console.log(`✅ ${tab} → ${file} (${rows} lines)`);
}
