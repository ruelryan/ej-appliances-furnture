/**
 * Computes the perceptual hash (dHash) for product photos that predate the
 * hashing upload path, so the duplicate-review queue can compare them.
 *
 *   npx tsx scripts/backfill-photo-hashes.ts            # dry run
 *   npx tsx scripts/backfill-photo-hashes.ts --apply
 *   npx tsx scripts/backfill-photo-hashes.ts --all      # re-hash everything
 *
 * MUST produce the same hash the browser does in src/lib/image.ts, or a photo
 * hashed here would never match one hashed at upload. Both do: resize to 9x8,
 * convert to greyscale with Rec. 601 luma, then compare each pixel with its
 * right neighbour for 64 bits. The greyscale is computed here from raw RGB
 * rather than sharp's .greyscale(), so the weighting is provably identical
 * instead of merely assumed; only the resampling kernel differs, which moves a
 * hash by a bit or two at most.
 */
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const ALL = process.argv.includes("--all");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const publicUrl = (path: string) =>
  `${url}/storage/v1/object/public/product-photos/${path}`;

/** Identical algorithm to dHash() in src/lib/image.ts. */
async function dHashFromBuffer(buf: Buffer): Promise<string> {
  const { data } = await sharp(buf)
    .resize(9, 8, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const grey: number[] = [];
  for (let i = 0; i < data.length; i += 3) {
    grey.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }

  let bits = "";
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      bits += grey[row * 9 + col] > grey[row * 9 + col + 1] ? "1" : "0";
    }
  }
  return bits;
}

function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

async function main() {
  let q = db
    .from("product_photos")
    .select("id, product_id, storage_path, dhash, products(name)")
    .order("created_at");
  if (!ALL) q = q.is("dhash", null);

  const { data: photos, error } = await q;
  if (error) throw new Error(error.message);
  if (!photos?.length) {
    console.log("Nothing to hash.");
    return;
  }
  console.log(`${photos.length} photo(s) to hash.\n`);

  const results: Array<{ id: string; path: string; name: string; hash: string }> = [];
  let failed = 0;

  for (const p of photos) {
    const name = (p.products as unknown as { name: string } | null)?.name ?? "?";
    try {
      const res = await fetch(publicUrl(p.storage_path));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const hash = await dHashFromBuffer(buf);
      results.push({ id: p.id, path: p.storage_path, name, hash });
      if (results.length % 25 === 0) console.log(`  ${results.length}/${photos.length}…`);
    } catch (e) {
      failed++;
      console.error(`  ! ${name}: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(`\nHashed ${results.length}, failed ${failed}.`);

  // Sanity: near-identical hashes across DIFFERENT products are the pairs the
  // review queue is meant to surface. Show the closest few as a smoke test.
  const close: string[] = [];
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const d = hamming(results[i].hash, results[j].hash);
      if (d <= 10) close.push(`${d} bits — "${results[i].name}" vs "${results[j].name}"`);
    }
  }
  console.log(`\nPairs within 10 bits (the review queue would flag these): ${close.length}`);
  for (const c of close.slice(0, 12)) console.log(`  ${c}`);

  const allZero = results.filter((r) => /^0+$/.test(r.hash) || /^1+$/.test(r.hash));
  if (allZero.length) {
    console.log(`\n! ${allZero.length} hash(es) are all-zero or all-one — likely blank images.`);
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write.");
    return;
  }

  let ok = 0, wrote = 0;
  for (const r of results) {
    // Direct table update, not set_product_photo_hash(). That RPC guards on
    // can_post_payments(), which reads auth.uid() — a service-role script has
    // no JWT user, so the guard always refuses. The service role bypasses RLS
    // anyway, so writing the column directly is both correct and simpler here.
    // The RPC remains the only path for the app, where a session user exists.
    const { error: e } = await db
      .from("product_photos")
      .update({ dhash: r.hash })
      .eq("id", r.id);
    if (e) console.error(`  ! ${r.name}: ${e.message}`);
    else ok++;
    if (++wrote % 25 === 0) console.log(`  wrote ${wrote}/${results.length}…`);
  }
  console.log(`\nWrote ${ok} hash(es).`);
}

main();
