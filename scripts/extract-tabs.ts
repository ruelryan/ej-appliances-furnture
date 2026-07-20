/**
 * Extracts the migration tabs from the Sheet as CSVs. Accepts either a Drive
 * download_file_content JSON result, or an .xlsx saved straight from
 * File > Download > Microsoft Excel (which avoids pulling 2 MB of base64
 * through a tool call).
 *   npx tsx scripts/extract-tabs.ts <download-result.json | workbook.xlsx> <output-dir>
 */
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

const [srcPath, outDir] = process.argv.slice(2);
if (!srcPath || !outDir) {
  console.error("Usage: npx tsx scripts/extract-tabs.ts <download-result.json | workbook.xlsx> <output-dir>");
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

const xlsxPath = path.join(outDir, "eandj-sheet.xlsx");
if (srcPath.toLowerCase().endsWith(".json")) {
  const payload = JSON.parse(fs.readFileSync(srcPath, "utf8"));
  fs.writeFileSync(xlsxPath, Buffer.from(payload.content, "base64"));
  console.log(`Saved workbook: ${xlsxPath} (${payload.title})`);
} else {
  // Copy to the canonical name so a re-run is reproducible from the folder alone.
  if (path.resolve(srcPath) !== path.resolve(xlsxPath)) {
    fs.copyFileSync(srcPath, xlsxPath);
  }
  console.log(`Using workbook: ${srcPath}`);
}

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
