/**
 * WRITE SPEC — delivery fulfilment from office stock: mark the TEST
 * contract's auto-enqueued delivery in_stock, link the TEST product,
 * mark delivered → on_hand decrements 1 → 0 and the ledger gets a
 * 'delivery' movement. Cleaned up with the TEST contract/product.
 */
import { test, expect } from "@playwright/test";
import { authState, serviceClient, E2E_PREFIX } from "../../helpers";

const PRODUCT_NAME = `${E2E_PREFIX} PRODUCT — DO NOT SELL`;

test.use({ storageState: authState("admin") });

test("in stock → link TEST product → mark delivered", async ({ page }) => {
  const { data: contracts } = await serviceClient()
    .from("contracts")
    .select("id, customers!inner(last_name)")
    .ilike("customers.last_name", `${E2E_PREFIX}%`);
  test.skip(!contracts?.length, "TEST contract missing");
  const { data: product } = await serviceClient()
    .from("products")
    .select("id, on_hand")
    .eq("name", PRODUCT_NAME)
    .single();
  test.skip(!product, "TEST product missing — run 50-products first");
  expect(product!.on_hand, "TEST product stock before delivery").toBe(1);

  await page.goto("/deliveries");
  const card = page.locator("div, li").filter({ hasText: E2E_PREFIX }).filter({
    has: page.getByRole("button", { name: "In stock" }),
  });
  await expect(card.last(), "TEST delivery visible").toBeVisible();
  await card.last().getByRole("button", { name: "In stock" }).click();

  // Link the TEST product (select titled "Link a catalog product").
  const productSelect = card.last().locator('select[title="Link a catalog product"]');
  const opts = await productSelect.locator("option").allTextContents();
  const idx = opts.findIndex((o) => o.includes(PRODUCT_NAME));
  expect(idx, "TEST product in the picker").toBeGreaterThanOrEqual(0);
  await productSelect.selectOption({ index: idx });

  // Mark delivered (native prompt for the note).
  page.on("dialog", (d) => d.accept("E2E TEST delivery — not real"));
  await card.last().getByRole("button", { name: "Mark delivered" }).click();

  await expect
    .poll(async () => {
      const { data } = await serviceClient()
        .from("deliveries")
        .select("status")
        .eq("contract_id", contracts![0].id)
        .single();
      return data?.status;
    })
    .toBe("delivered");

  // Stock decremented and ledgered.
  const { data: after } = await serviceClient().from("products").select("on_hand").eq("id", product!.id).single();
  expect(after?.on_hand).toBe(0);
  const { data: moves } = await serviceClient()
    .from("stock_movements")
    .select("reason, delta")
    .eq("product_id", product!.id)
    .eq("reason", "delivery");
  expect(moves).toHaveLength(1);
  expect(moves![0].delta).toBe(-1);
});
