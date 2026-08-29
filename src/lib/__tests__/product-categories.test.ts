import { describe, expect, it } from "vitest";
import { ITEM_TYPES } from "../messages";
import {
  CATEGORY_ITEM_TYPE,
  CATEGORY_RULES,
  categoriesFor,
  categoryForName,
  itemTypeForCategory,
} from "../product-categories";

/**
 * These guard a bug that reached production on 2026-08-29.
 *
 * `products.category` was backfilled with a fine browse taxonomy
 * (Refrigerator, Sala Set, …). The new-contract form pre-filled the contract's
 * item type by assigning that value straight across — `setItemType(p.category)`
 * — but `contracts.item_type` is constrained by `contracts_item_type_check`
 * (0003) to exactly 'Appliances', 'Furniture' or null. Picking a product on
 * the form therefore staged a value the insert would reject.
 *
 * Nothing caught it: it type-checks (both are strings), it builds, and the
 * failure only appears when a real contract is saved. So the invariants are
 * asserted here instead.
 */
describe("product categories", () => {
  it("maps every category to a contract item type the database accepts", () => {
    for (const [category, type] of Object.entries(CATEGORY_ITEM_TYPE)) {
      expect(ITEM_TYPES, `${category} maps to "${type}", which the CHECK constraint rejects`)
        .toContain(type);
    }
  });

  it("has an item type for every category the backfill can write", () => {
    // A rule that produces a category with no mapping means the backfill
    // writes a value the new-contract form cannot translate, and the field
    // silently stops pre-filling.
    const unmapped = CATEGORY_RULES.map((r) => r.category).filter(
      (c) => !(c in CATEGORY_ITEM_TYPE)
    );
    expect(unmapped).toEqual([]);
  });

  it("never returns a raw category as an item type", () => {
    for (const category of Object.keys(CATEGORY_ITEM_TYPE)) {
      const type = itemTypeForCategory(category);
      expect(type).not.toBe(category);
      expect(ITEM_TYPES).toContain(type);
    }
  });

  it("returns null rather than guessing for unknown or missing categories", () => {
    // Two products are deliberately uncategorised. The form must leave the
    // field alone for a person, not invent a value.
    expect(itemTypeForCategory(null)).toBeNull();
    expect(itemTypeForCategory(undefined)).toBeNull();
    expect(itemTypeForCategory("")).toBeNull();
    expect(itemTypeForCategory("Corio Wooden")).toBeNull();
  });

  it("keeps both browse menus inside Messenger's 13 quick-reply limit", () => {
    for (const type of ITEM_TYPES) {
      expect(categoriesFor(type).length, `${type} categories`).toBeLessThanOrEqual(13);
      expect(categoriesFor(type).length, `${type} has no categories`).toBeGreaterThan(0);
    }
  });

  describe("name matching — order-sensitive cases", () => {
    it("files a chiller/refrigerator as a Chiller, not a household fridge", () => {
      expect(categoryForName("Haier Upright Chiller/Refrigerator 5.8 Cu. Ft. HUF-D170"))
        .toBe("Chiller");
    });

    it("files a sala set with Sofa in the name as a Sala Set", () => {
      expect(categoryForName("Sala Set Standard Sofa (Design 1)(Brown) SSSS1(B)"))
        .toBe("Sala Set");
    });

    it("files a chest freezer as a Freezer, not a Cabinet", () => {
      expect(categoryForName("Haier Chest Freezer 7 Cu. Ft. BD-206HI")).toBe("Freezer");
    });

    it("files Dew Foam with beds", () => {
      expect(categoryForName("Dew Foam Queen Size 4x60x75 DFQS460")).toBe("Bed");
    });

    it("recognises the real catalogue's usual shapes", () => {
      expect(categoryForName("Sharp Refrigerator 7 cu ft 2 Doors SJ-VL70BP-SL")).toBe("Refrigerator");
      expect(categoryForName("TCL Washing Machine 9 kg Twin Tub TWT-90Z2")).toBe("Washing Machine");
      expect(categoryForName("Devant TV 43 in Smart 43STV103")).toBe("Television");
      expect(categoryForName("Carrier Airconditioner 1.5 HP Split Type")).toBe("Aircon");
      expect(categoryForName("Steel Bed Double Deck 36x36x75 (Black)")).toBe("Bed");
      expect(categoryForName("Dining Table 8 Seaters Mahogany Wood (Design 1)")).toBe("Dining Set");
    });

    it("returns null instead of forcing an unrecognised product into a bucket", () => {
      expect(categoryForName("Corio Wooden (Design 1) CW1")).toBeNull();
    });
  });
});
