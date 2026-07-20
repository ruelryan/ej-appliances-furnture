/**
 * One-time import of the Google Sheet "Pricelist" tab into the products
 * catalog. Photos are NOT imported (embedded sheet images can't be exported —
 * re-upload them in the app on /products).
 *
 * Export the Pricelist tab to CSV, then:
 *   npx tsx scripts/import-products.ts --file <path.csv>          # dry run (preview)
 *   npx tsx scripts/import-products.ts --file <path.csv> --load   # actually insert
 *
 * Column headers are auto-detected (name/price/cost/stock/category). Rows with
 * no name are skipped. Inserts run as the DB owner (bypassing the RPC guards),
 * generating SKUs from id_counters and logging a 'restock' stock movement.
 */
import fs from "node:fs";
import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

// ── tiny CSV parser (handles quotes, commas, newlines) ──────────
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r") { /* skip */ }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

function pickCol(headers: string[], candidates: string[]): number {
  const h = headers.map((x) => x.trim().toLowerCase());
  for (const cand of candidates) {
    const i = h.findIndex((x) => x === cand || x.includes(cand));
    if (i >= 0) return i;
  }
  return -1;
}

function num(s: string | undefined): number | null {
  if (!s) return null;
  const v = Number(s.replace(/[₱,\s]/g, ""));
  return Number.isFinite(v) ? v : null;
}

async function main() {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf("--file");
  const file = fileIdx >= 0 ? args[fileIdx + 1] : null;
  const load = args.includes("--load");
  if (!file) { console.error("Usage: --file <csv> [--load]"); process.exit(1); }

  const rows = parseCSV(fs.readFileSync(file, "utf8"));
  if (rows.length < 2) { console.error("CSV has no data rows."); process.exit(1); }
  const headers = rows[0];
  const cName = pickCol(headers, ["name", "product", "item", "description", "model"]);
  const cPrice = pickCol(headers, ["price", "srp", "selling"]);
  const cCost = pickCol(headers, ["cost", "supplier"]);
  const cStock = pickCol(headers, ["stock", "on hand", "onhand", "qty", "quantity", "count", "available"]);
  const cCat = pickCol(headers, ["category", "type"]);
  console.log("Detected columns:", { name: headers[cName], price: headers[cPrice], cost: headers[cCost], stock: headers[cStock], category: headers[cCat] });
  if (cName < 0) { console.error("Could not find a product-name column."); process.exit(1); }

  const items = rows.slice(1)
    .map((r) => ({
      name: (r[cName] ?? "").trim(),
      price: cPrice >= 0 ? num(r[cPrice]) : null,
      cost: cCost >= 0 ? num(r[cCost]) : null,
      stock: cStock >= 0 ? (num(r[cStock]) ?? 0) : 0,
      category: cCat >= 0 ? (r[cCat] ?? "").trim() || null : null,
    }))
    .filter((x) => x.name);

  console.log(`\n${items.length} products to import. First 5:`);
  console.table(items.slice(0, 5));

  if (!load) { console.log("\nDry run. Re-run with --load to insert."); return; }

  const password = process.env.SUPABASE_DB_PASSWORD!;
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];
  const c = new Client({ host: "aws-1-ap-south-1.pooler.supabase.com", port: 5432, user: `postgres.${ref}`, password, database: "postgres", ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("begin");
  try {
    let n = 0;
    for (const it of items) {
      const sku = "PRD" + String((await c.query(`select public.next_counter('product') as v`)).rows[0].v).padStart(4, "0");
      const prod = (await c.query(
        `insert into public.products (sku, name, category, price, default_cost, on_hand) values ($1,$2,$3,$4,$5,$6) returning id`,
        [sku, it.name, it.category, it.price, it.cost, Math.max(0, Math.trunc(it.stock))]
      )).rows[0];
      if (it.stock > 0) {
        await c.query(
          `insert into public.stock_movements (product_id, delta, reason, note) values ($1,$2,'restock','Pricelist import')`,
          [prod.id, Math.trunc(it.stock)]
        );
      }
      n++;
    }
    await c.query("commit");
    console.log(`\n✅ Imported ${n} products.`);
  } catch (e) {
    await c.query("rollback");
    console.error("Import failed, rolled back:", (e as Error).message);
  } finally {
    await c.end();
  }
}
main();
