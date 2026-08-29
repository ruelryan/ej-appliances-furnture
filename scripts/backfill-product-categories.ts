/**
 * Fill in products.category, which is empty on 135 of 140 rows.
 *
 *   npx tsx scripts/backfill-product-categories.ts            # dry run, prints every proposal
 *   npx tsx scripts/backfill-product-categories.ts --apply    # writes
 *
 * Why. The column exists but was never populated, so /products has no way to
 * group anything and the Messenger bot's browse menu cannot be built at all.
 * Product names are well structured ("Sharp Refrigerator 7 cu ft 2 Doors"), so
 * the category is derivable from the name with rules that are readable and
 * arguable, rather than guessed by a model.
 *
 * Safety. This touches ONLY `category`. It does not go near `on_hand`, so the
 * stock_movements ledger that CLAUDE.md protects is unaffected — the RPC-only
 * rule exists to keep that ledger complete, and a category has nothing to do
 * with it. `products` has a SELECT policy and no write policy at all, so the
 * browser cannot write here regardless; the service-role key is what lets a
 * script through, exactly as with the other backfills.
 *
 * Read the dry run before applying. The proposals are a judgement about how
 * customers will be shown the catalogue, and some are genuinely arguable —
 * whether a commercial upright chiller belongs with refrigerators, for one.
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { categoryForName, itemTypeForCategory } from "@/lib/product-categories";

dotenv.config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const db = createClient(url, key);

// The name -> category rules and the category -> item-type map both live in
// src/lib/product-categories.ts, so this script and the app cannot disagree
// about what a category is. They are unit-tested there; this file is only the
// runner. That split exists because the first version duplicated the mapping
// and the copies drifted immediately.
type Group = "Appliances" | "Furniture" | "Other";


const GROUP_ORDER: Group[] = ["Appliances", "Furniture", "Other"];

const peso = (n: unknown) =>
  "₱" + Number(n ?? 0).toLocaleString("en-PH", { maximumFractionDigits: 0 });

type Row = { id: string; name: string; category: string | null; price: number | null };

async function main() {
  const { data, error } = await db
    .from("products")
    .select("id, name, category, price")
    .order("name");
  if (error) {
    console.error("Could not read products:", error.message);
    process.exit(1);
  }
  const products = (data ?? []) as Row[];

  const proposals = products.map((p) => {
    const proposed = categoryForName(p.name);
    const group: Group = (proposed ? itemTypeForCategory(proposed) : null) ?? "Other";
    return { ...p, proposed, group };
  });

  // ── Report, grouped the way a customer would be shown it ────────────────
  const byCategory = new Map<string, typeof proposals>();
  for (const p of proposals) {
    const k = p.proposed ?? "(NO MATCH)";
    if (!byCategory.has(k)) byCategory.set(k, []);
    byCategory.get(k)!.push(p);
  }

  for (const group of GROUP_ORDER) {
    const cats = [...byCategory.entries()]
      .filter(([, rows]) => rows[0].group === group)
      .sort((a, b) => b[1].length - a[1].length);
    if (!cats.length) continue;
    console.log(`\n${"═".repeat(64)}\n${group.toUpperCase()}\n${"═".repeat(64)}`);
    for (const [cat, rows] of cats) {
      const prices = rows.map((r) => Number(r.price ?? 0)).filter((n) => n > 0);
      const range = prices.length
        ? `${peso(Math.min(...prices))} – ${peso(Math.max(...prices))}`
        : "no price";
      console.log(`\n  ${cat}  (${rows.length})   ${range}`);
      for (const r of rows) {
        const was = r.category ? `  [was: ${r.category}]` : "";
        console.log(`      ${r.name.slice(0, 62)}${was}`);
      }
    }
  }

  const unmatched = proposals.filter((p) => !p.proposed);
  const changed = proposals.filter((p) => p.proposed && p.proposed !== p.category);
  const overwritten = changed.filter((p) => p.category);

  console.log(`\n${"═".repeat(64)}`);
  console.log(`  ${products.length} products`);
  console.log(`  ${products.length - unmatched.length} matched a rule`);
  console.log(`  ${changed.length} would change`);
  if (overwritten.length) {
    console.log(
      `  ${overwritten.length} already had a category and would be REPLACED ` +
        `with something more specific:`
    );
    for (const p of overwritten)
      console.log(`      ${p.category} → ${p.proposed}   ${p.name.slice(0, 46)}`);
  }

  if (unmatched.length) {
    console.log(`\n  ${unmatched.length} MATCHED NOTHING — decide these by hand:`);
    for (const p of unmatched) console.log(`      ${p.name}`);
    console.log(
      `\n  Leaving a product uncategorised is safe: it stays searchable and\n` +
        `  simply does not appear under a browse category.`
    );
  }

  // The bot must not put a product it cannot describe in front of a customer.
  // The floor is deliberately low: "Buffet 5ft." is a real, complete product
  // name and should not be nagged about. Anything shorter than that is a
  // fragment rather than a name.
  const junk = proposals.filter((p) => p.name.trim().length < 9);
  if (junk.length) {
    console.log(`\n  ⚠ Names too short to show a customer — fix or remove these:`);
    for (const p of junk) console.log(`      "${p.name}"  (${peso(p.price)})`);
  }

  if (!changed.length) {
    console.log("\nNothing to change.");
    return;
  }

  if (!APPLY) {
    console.log(`\n🔁 Dry run — nothing written. Re-run with --apply to write ${changed.length} categories.`);
    return;
  }

  let done = 0;
  for (const p of changed) {
    const { error: e } = await db
      .from("products")
      .update({ category: p.proposed })
      .eq("id", p.id);
    if (e) {
      console.error(`  failed on ${p.name}: ${e.message}`);
      continue;
    }
    done++;
  }
  console.log(`\n✅ Wrote ${done} categories.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
