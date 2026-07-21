/**
 * WRITE SPEC — the collections pipeline on the TEST contract:
 * owner assigns the TEST collector → collector logs a "collected" entry
 * (booklet receipt no) and a "promised" entry (promised date) → admin
 * posts the collected entry (becomes a payment) and cancels the promise.
 * Exercises assign_collector, log_collection, post_collection_entry,
 * cancel_collection_entry. Cleaned up with the TEST contract.
 */
import { test, expect } from "@playwright/test";
import { authState, serviceClient, E2E_PREFIX, testUserId } from "../../helpers";

async function testContractId(): Promise<string | null> {
  const { data } = await serviceClient()
    .from("contracts")
    .select("id, customers!inner(last_name)")
    .ilike("customers.last_name", `${E2E_PREFIX}%`);
  return data?.[0]?.id ?? null;
}

test.describe("assign", () => {
  test.use({ storageState: authState("owner") });

  test("owner assigns the TEST collector", async ({ page }) => {
    test.skip(!(await testContractId()), "TEST contract missing");
    await page.goto("/collections");
    const row = page
      .locator("tr, li, div")
      .filter({ hasText: E2E_PREFIX })
      .filter({ has: page.getByRole("button", { name: /^(Assign|Reassign)$/ }) })
      .last();
    await row.getByRole("button", { name: /^(Assign|Reassign)$/ }).click();
    await page
      .locator("select")
      .filter({ has: page.locator("option", { hasText: "E2E TEST — DO NOT USE (Collector)" }) })
      .first()
      .selectOption({ label: "E2E TEST — DO NOT USE (Collector)" });
    await page.getByRole("button", { name: "Save" }).click();

    await expect
      .poll(async () => {
        const { data } = await serviceClient()
          .from("contracts")
          .select("collector_id")
          .eq("id", (await testContractId())!)
          .single();
        return data?.collector_id;
      })
      .toBe(testUserId("COLLECTOR"));
  });
});

test.describe("log", () => {
  test.use({ storageState: authState("collector") });

  test("collector logs a collected entry and a promise", async ({ page }) => {
    test.skip(!(await testContractId()), "TEST contract missing");
    await page.goto("/collections");
    const card = page.locator("div, li").filter({ hasText: E2E_PREFIX }).filter({
      has: page.getByRole("button", { name: "Log" }),
    });
    await expect(card.last(), "TEST account on the worklist").toBeVisible();

    // Entry 1: collected ₱50 cash with a booklet receipt number.
    await card.last().getByRole("button", { name: "Log" }).click();
    await page.getByPlaceholder("0.00").fill("50");
    await page.getByPlaceholder("Number from your receipt booklet").fill("E2E-BOOKLET-1");
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(page.getByPlaceholder("0.00")).toHaveCount(0); // dialog closed

    // Entry 2: promised to pay (date defaults ~a week out).
    await card.last().getByRole("button", { name: "Log" }).click();
    await page.getByRole("button", { name: "Promised to pay" }).click();
    await page.getByRole("button", { name: "Save entry" }).click();

    await expect
      .poll(async () => {
        const { count } = await serviceClient()
          .from("collection_entries")
          .select("*", { count: "exact", head: true })
          .eq("contract_id", (await testContractId())!);
        return count;
      })
      .toBe(2);
  });
});

test.describe("post and cancel", () => {
  test.use({ storageState: authState("admin") });

  test("admin posts the collected entry and cancels the promise", async ({ page }) => {
    const contractId = await testContractId();
    test.skip(!contractId, "TEST contract missing");

    await page.goto("/collections");
    // "To post" section: post the collected entry.
    const postRow = page.locator("tr, li, div").filter({ hasText: E2E_PREFIX }).filter({
      has: page.getByRole("button", { name: "Post payment" }),
    });
    await postRow.last().getByRole("button", { name: "Post payment" }).click();
    await page.getByPlaceholder("e.g. 00123").fill("E2E-TEST-OR-2");
    await page.getByRole("button", { name: "Post & print" }).click();
    await page.waitForURL(/\/print\/receipt\/[0-9a-f-]{36}$/, { timeout: 60_000 });

    // Cancel the promise entry (native prompt).
    await page.goto("/collections");
    page.on("dialog", (d) => d.accept("E2E TEST cancellation"));
    const cancelRow = page.locator("tr, li, div").filter({ hasText: E2E_PREFIX }).filter({
      has: page.getByRole("button", { name: "Cancel" }),
    });
    await cancelRow.last().getByRole("button", { name: "Cancel" }).click();

    await expect
      .poll(async () => {
        const { data } = await serviceClient()
          .from("collection_entries")
          .select("status")
          .eq("contract_id", contractId!)
          .order("created_at");
        return (data ?? []).map((r) => r.status).sort();
      })
      .toEqual(["cancelled", "posted"]);
  });
});
