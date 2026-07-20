/**
 * One-time import of the Sheet "Pricelist" tab into the products catalog,
 * INCLUDING photos (fetched from the Google Drive links in the sheet — the
 * files are link-shared, so a direct download works).
 *
 *   npx tsx scripts/import-pricelist.ts --file <pricelist.csv>          # dry run
 *   npx tsx scripts/import-pricelist.ts --file <pricelist.csv> --load   # write to prod
 *
 * Columns (fixed for this sheet): C=Model, D=Price, E=On-hand, F=Picture URL,
 * G=Specification. Product name = the Drive photo's filename (brand + model,
 * e.g. "Haier HTW70-P1217 (7.0kg)"), falling back to the model. Full spec →
 * description. Photos upload to the public `product-photos` bucket.
 */
import fs from "node:fs";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r") { /* skip */ }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const num = (s: string | undefined): number | null => {
  if (!s) return null;
  const v = Number(String(s).replace(/[₱,\s]/g, ""));
  return Number.isFinite(v) ? v : null;
};

async function fetchDrivePhoto(id: string): Promise<{ name: string; buf: Buffer; ct: string } | null> {
  try {
    const r = await fetch(`https://drive.usercontent.google.com/download?id=${id}&export=download`, { redirect: "follow" });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) return null;
    const cd = r.headers.get("content-disposition") || "";
    const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^"]+?)"?$/);
    const fname = m ? decodeURIComponent(m[1]) : "";
    const name = fname.replace(/\.(jpe?g|png|webp|gif)$/i, "").trim();
    return { name, buf: Buffer.from(await r.arrayBuffer()), ct };
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const file = args[args.indexOf("--file") + 1];
  const load = args.includes("--load");
  if (!file || args.indexOf("--file") < 0) { console.error("Usage: --file <csv> [--load]"); process.exit(1); }

  const rows = parseCSV(fs.readFileSync(file, "utf8"));

  // Columns are resolved BY HEADER NAME, not by fixed position. The original
  // version hard-coded C=Model/D=Price/…, which silently depended on the CSV
  // export carrying a leading blank column — one layout change and every field
  // shifts. Note the Sheet misspells "Item Decription"; both spellings match.
  const headerRow = rows.findIndex(
    (r) => r.some((c) => /^model$/i.test(String(c).trim())) &&
           r.some((c) => /^price$/i.test(String(c).trim()))
  );
  if (headerRow < 0) {
    console.error('Could not find the Pricelist header row (needs "Model" and "Price").');
    process.exit(1);
  }
  const hdr = rows[headerRow].map((h) => String(h).trim().toLowerCase());
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = hdr.indexOf(n.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };
  const cName = col("Item Decription", "Item Description", "Description");
  const cModel = col("Model");
  const cPrice = col("Price");
  const cStock = col("On-hand", "On hand", "Onhand");
  const cPic = col("Picture", "Photo", "Image");
  const cSpec = col("Specification", "Specs", "Spec");
  console.log(
    `Columns → name:${cName} model:${cModel} price:${cPrice} stock:${cStock} pic:${cPic} spec:${cSpec}`
  );
  if (cName < 0) console.warn('  ! No "Item Decription" column — names will fall back to the photo filename.');

  const at = (r: string[], i: number) => (i >= 0 ? (r[i] || "").trim() : "");
  const items = rows.slice(headerRow + 1).map((r) => {
    const pic = at(r, cPic);
    const driveId = (pic.match(/\/d\/([A-Za-z0-9_-]+)/) || pic.match(/[?&]id=([A-Za-z0-9_-]+)/) || [])[1] || null;
    return {
      sheetName: at(r, cName),
      model: at(r, cModel),
      price: cPrice >= 0 ? num(r[cPrice]) : null,
      stock: Math.max(0, Math.round((cStock >= 0 ? num(r[cStock]) : 0) ?? 0)),
      driveId,
      spec: at(r, cSpec),
    };
  }).filter((x) => x.model || x.sheetName);

  console.log(`${items.length} products found. ${items.filter((x) => x.driveId).length} have a photo link.\n`);

  if (!load) {
    console.log("DRY RUN — first 8 rows as they would import:");
    for (const it of items.slice(0, 8)) {
      const ph = it.driveId ? await fetchDrivePhoto(it.driveId) : null;
      const name = it.sheetName || ph?.name || it.model;
      console.log(`  • ${name}  —  ₱${it.price ?? "?"} · stock ${it.stock}${ph ? " · photo ✓" : it.driveId ? " · photo ✗" : ""}`);
    }
    console.log("\nRe-run with --load to import for real.");
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const ref = new URL(url).hostname.split(".")[0];
  const pg = new Client({ host: "aws-1-ap-south-1.pooler.supabase.com", port: 5432, user: `postgres.${ref}`, password: process.env.SUPABASE_DB_PASSWORD!, database: "postgres", ssl: { rejectUnauthorized: false } });
  await pg.connect();
  const store = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  // Clean any prior run so re-importing is safe (the catalog is import-only).
  if (args.includes("--reset")) {
    const old = (await pg.query(`select storage_path from product_photos`)).rows.map((r) => r.storage_path);
    for (let i = 0; i < old.length; i += 100) await store.storage.from("product-photos").remove(old.slice(i, i + 100));
    await pg.query(`delete from public.stock_movements`);
    await pg.query(`delete from public.product_photos`);
    await pg.query(`delete from public.products`);
    console.log(`reset: cleared ${old.length} photos + existing products\n`);
  }

  let n = 0, photos = 0, photoFail = 0;
  for (const it of items) {
    const ph = it.driveId ? await fetchDrivePhoto(it.driveId) : null;
    // Name comes from the Sheet's "Item Decription" column — that is the
    // human-readable product name, and it is what lands on a customer's
    // contract and receipt. The photo filename / spec line are only fallbacks
    // for rows where that column is blank; they yield model codes like
    // "Haier HTW70-P1217 (7.0kg)" instead of "Haier Washing Machine 7.0 kg
    // Twin Tub", which is what the first import produced for all 146 rows.
    const goodFile = !!ph?.name && /[A-Za-z]{3,}/.test(ph.name) && !/^\d{6,}/.test(ph.name.trim());
    const specName = it.spec ? it.spec.split(/\n/)[0].split(/\.\s/)[0].trim().slice(0, 80) : "";
    const specOk = (specName.match(/[A-Za-z]{3,}/g) || []).length >= 2;
    const name = (it.sheetName || (goodFile ? ph!.name : specOk ? specName : it.model)).slice(0, 200);
    const description = ["Model: " + it.model, it.spec].filter(Boolean).join("\n");
    const sku = "PRD" + String((await pg.query(`select public.next_counter('product') as v`)).rows[0].v).padStart(4, "0");
    const prod = (await pg.query(
      `insert into public.products (sku, name, price, on_hand, description) values ($1,$2,$3,$4,$5) returning id`,
      [sku, name, it.price, it.stock, description]
    )).rows[0];
    if (it.stock > 0) {
      await pg.query(`insert into public.stock_movements (product_id, delta, reason, note) values ($1,$2,'restock','Pricelist import')`, [prod.id, it.stock]);
    }
    if (ph) {
      const ext = ph.ct.includes("png") ? "png" : ph.ct.includes("webp") ? "webp" : "jpg";
      const path = `${prod.id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await store.storage.from("product-photos").upload(path, ph.buf, { contentType: ph.ct, upsert: true });
      if (error) { photoFail++; }
      else { await pg.query(`insert into public.product_photos (product_id, storage_path) values ($1,$2)`, [prod.id, path]); photos++; }
    } else if (it.driveId) photoFail++;
    n++;
    if (n % 20 === 0) console.log(`  … ${n}/${items.length} (photos ${photos}, failed ${photoFail})`);
  }
  await pg.end();
  console.log(`\n✅ Imported ${n} products, ${photos} photos (${photoFail} photo failures).`);
}
main();
