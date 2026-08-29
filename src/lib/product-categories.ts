// The catalogue's browse categories, and which of the two contract item types
// each one belongs to.
//
// These are two different taxonomies and conflating them breaks contract
// creation. `contracts.item_type` is a FIXED two-value column — the
// `contracts_item_type_check` constraint (0003) permits only 'Appliances',
// 'Furniture' or null. `products.category` is the much finer browse taxonomy
// filled in on 2026-08-29 (Refrigerator, Sala Set, Aircon …), which exists so
// /products can group and so the Messenger bot can offer a menu.
//
// The new-contract form pre-fills the item type from the picked product, so it
// MUST map through here rather than assigning the category straight across —
// doing that sets item_type to "Refrigerator" and the insert is rejected.

import { ITEM_TYPES } from "./messages";

export type ItemType = (typeof ITEM_TYPES)[number];

/** Browse category → contract item type. Keys are the values written by
 *  scripts/backfill-product-categories.ts; the two must not drift. */
export const CATEGORY_ITEM_TYPE: Record<string, ItemType> = {
  // Appliances
  Refrigerator: "Appliances",
  "Washing Machine": "Appliances",
  Television: "Appliances",
  Aircon: "Appliances",
  Chiller: "Appliances",
  Freezer: "Appliances",
  "Gas Range": "Appliances",
  "Water Dispenser": "Appliances",
  "Sewing Machine": "Appliances",
  Laptop: "Appliances",
  Printer: "Appliances",

  // Furniture
  "Sala Set": "Furniture",
  Sofa: "Furniture",
  Bed: "Furniture",
  "Dining Set": "Furniture",
  Cabinet: "Furniture",
  Chair: "Furniture",
  Table: "Furniture",
  Door: "Furniture",
  Mirror: "Furniture",
};

/**
 * The contract item type for a browse category, or null when there isn't one.
 *
 * Null is a real answer, not a failure: two products are deliberately
 * uncategorised, and an unrecognised category must leave the field alone for a
 * person to choose rather than guess a value the database will reject.
 */
export function itemTypeForCategory(category: string | null | undefined): ItemType | null {
  if (!category) return null;
  return CATEGORY_ITEM_TYPE[category] ?? null;
}

/** Categories belonging to one item type, for a browse menu. */
export function categoriesFor(type: ItemType): string[] {
  return Object.entries(CATEGORY_ITEM_TYPE)
    .filter(([, t]) => t === type)
    .map(([c]) => c)
    .sort();
}

/**
 * Ordered name → category rules. FIRST MATCH WINS, so a specific rule must
 * precede the general one it would otherwise be swallowed by.
 *
 * These live here rather than in the backfill script so there is one place
 * that decides what a category is, and so they are testable. The script is
 * only the runner.
 */
export const CATEGORY_RULES: { category: string; match: RegExp }[] = [
  // Chiller before Refrigerator: one product reads "Upright Chiller/
  // Refrigerator" and is a display chiller a sari-sari store buys, not a
  // household fridge.
  { category: "Chiller", match: /chiller/i },
  { category: "Freezer", match: /freezer/i },
  { category: "Refrigerator", match: /refrigerator|fridge/i },
  { category: "Washing Machine", match: /washing machine/i },
  { category: "Television", match: /\bTV\b|television/i },
  { category: "Aircon", match: /aircon|air ?conditioner/i },
  { category: "Gas Range", match: /gas burner|gas range|cooking|stove|oven/i },
  { category: "Water Dispenser", match: /dispenser/i },
  { category: "Sewing Machine", match: /sewing/i },
  { category: "Laptop", match: /laptop|aspire|vivobook/i },
  { category: "Printer", match: /printer/i },

  // Sala Set before Sofa: several sala sets carry "Sofa" in the name and are
  // sold as the whole set.
  { category: "Sala Set", match: /sala set/i },
  { category: "Dining Set", match: /dining/i },
  // Dew Foam is a mattress, which is how it is bought.
  { category: "Bed", match: /\bbed\b|mattress|dew foam/i },
  { category: "Sofa", match: /sofa|couch/i },
  { category: "Cabinet", match: /cabinet|buffet|chinaware|wardrobe|cupboard/i },
  { category: "Chair", match: /\bchair\b|stool/i },
  { category: "Table", match: /\btable\b|\bdesk\b/i },
  { category: "Door", match: /\bdoor\b/i },
  { category: "Mirror", match: /mirror/i },
];

/** The browse category for a product name, or null if nothing matches. */
export function categoryForName(name: string): string | null {
  return CATEGORY_RULES.find((r) => r.match.test(name))?.category ?? null;
}
