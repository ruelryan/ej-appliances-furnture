/**
 * WRITE SPEC — inventory: create the TEST product, restock +2, adjust −1.
 * merge_products (irreversible) and create_product_for_contract (leaks a
 * review task to the real admin role) are deliberately NOT tested.
 * Cleaned up by name prefix.
 */
import { test, expect } from "@playwright/test";
import { authState, serviceClient, E2E_PREFIX } from "../../helpers";

const PRODUCT_NAME = `${E2E_PREFIX} PRODUCT — DO NOT SELL`;

test.use({ storageState: authState("admin") });

test("create, restock, adjust the TEST product", async ({ page }) => {
  const { count } = await serviceClient()
    .from("products")
    .select("*", { count: "exact", head: true })
    .eq("name", PRODUCT_NAME);
  test.skip((count ?? 0) > 0, "TEST product already exists — run cleanup first");

  await page.goto("/products");
  await page.getByPlaceholder("Product name").fill(PRODUCT_NAME);
  await page.getByPlaceholder("Selling price (₱)").fill("1");
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.getByText(PRODUCT_NAME).first()).toBeVisible();

  const card = page.locator("div, li").filter({ hasText: PRODUCT_NAME }).filter({
    has: page.getByRole("button", { name: "Restock" }),
  });

  // Restock +2 (native prompt).
  let promptReply = "2";
  page.on("dialog", (d) => d.accept(promptReply));
  await card.last().getByRole("button", { name: "Restock" }).click();
  await expect
    .poll(async () => {
      const { data } = await serviceClient().from("products").select("on_hand").eq("name", PRODUCT_NAME).single();
      return data?.on_hand;
    })
    .toBe(2);

  // Adjust −1 (native prompt).
  promptReply = "-1";
  await card.last().getByRole("button", { name: "Adjust" }).click();
  await expect
    .poll(async () => {
      const { data } = await serviceClient().from("products").select("on_hand").eq("name", PRODUCT_NAME).single();
      return data?.on_hand;
    })
    .toBe(1);

  // Ledger completeness: both movements recorded.
  const { data: product } = await serviceClient().from("products").select("id").eq("name", PRODUCT_NAME).single();
  const { data: moves } = await serviceClient()
    .from("stock_movements")
    .select("delta, reason")
    .eq("product_id", product!.id)
    .order("created_at");
  expect(moves?.map((m) => `${m.reason}:${m.delta}`)).toEqual(["restock:2", "adjust:-1"]);
});
