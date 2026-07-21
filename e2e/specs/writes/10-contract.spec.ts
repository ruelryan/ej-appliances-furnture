/**
 * WRITE SPEC — creates a TEST customer + 6-month installment contract in
 * PRODUCTION. Cleaned up by scripts/e2e/cleanup-test-data.ts.
 *
 * The contract is back-dated ~2 months so it becomes overdue and appears
 * on the collector worklist for 30-collections.spec.ts.
 * ₱1,000 cash price, 6-month term → DP 250, total 1,225, monthly 162.50
 * (computeTerms golden math).
 */
import { test, expect } from "@playwright/test";
import { authState, serviceClient, E2E_PREFIX } from "../../helpers";

test.use({ storageState: authState("admin") });

test("admin creates the TEST installment contract", async ({ page }) => {
  // Guard: don't create twice if a previous run wasn't cleaned up.
  const { count } = await serviceClient()
    .from("customers")
    .select("*", { count: "exact", head: true })
    .ilike("last_name", `${E2E_PREFIX}%`);
  test.skip((count ?? 0) > 0, "TEST customer already exists — run cleanup first");

  await page.goto("/contracts/new");

  // Inline new customer
  await page.getByRole("button", { name: "+ New customer" }).click();
  await page.locator('[name="last_name"]').fill(`${E2E_PREFIX} — DO NOT USE`);
  await page.locator('[name="first_name"]').fill("Customer");
  await page.getByLabel("Province").selectOption({ index: 1 });
  await page.getByLabel("Municipality / City").selectOption({ index: 1 });
  await page.getByLabel("Barangay").selectOption({ index: 1 });

  // Item — typed directly, no catalog product linked (keeps stock untouched;
  // the delivery gets linked to the TEST product later in 60-delivery).
  await page.locator('[name="item_description"]').fill(`${E2E_PREFIX} ITEM — DO NOT DELIVER`);
  await page.locator('[name="cash_price"]').fill("1000");

  // 6-month term — the term select is the one whose options mention months.
  const termSelect = page
    .locator("select")
    .filter({ has: page.locator("option", { hasText: /month/i }) })
    .first();
  const options = await termSelect.locator("option").allTextContents();
  const idx = options.findIndex((o) => o.includes("6"));
  expect(idx, `6-month option among: ${options.join(" | ")}`).toBeGreaterThanOrEqual(0);
  await termSelect.selectOption({ index: idx });

  // Back-date so the account is overdue (worklist eligibility).
  const backdate = new Date();
  backdate.setMonth(backdate.getMonth() - 2);
  await page.locator('[name="contract_date"]').fill(backdate.toISOString().slice(0, 10));

  // No agent → Office Sales → no commission row is created.
  await page.getByRole("button", { name: "Create Contract" }).click();
  await page.waitForURL(/\/contracts\/[0-9a-f-]{36}$/, { timeout: 60_000 });

  // Golden math on the detail page: total 1,225.00, monthly 162.50
  const body = await page.locator("body").innerText();
  expect(body).toContain("162.50");
  expect(body).toContain("1,225");

  // The after-insert trigger enqueued a delivery.
  const contractId = page.url().split("/").pop()!;
  const { data: delivery } = await serviceClient()
    .from("deliveries")
    .select("id, status")
    .eq("contract_id", contractId);
  expect(delivery?.length, "auto-enqueued delivery row").toBe(1);
  expect(delivery![0].status).toBe("pending");

  // No commission row (no agent).
  const { count: commCount } = await serviceClient()
    .from("commissions")
    .select("*", { count: "exact", head: true })
    .eq("contract_id", contractId);
  expect(commCount ?? 0).toBe(0);

  // Print page renders.
  const res = await page.goto(`/print/contract/${contractId}`);
  expect(res!.status()).toBeLessThan(400);
});
