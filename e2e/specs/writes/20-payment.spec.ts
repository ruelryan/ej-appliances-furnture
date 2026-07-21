/**
 * WRITE SPEC — records a ₱250 payment (the downpayment) on the TEST
 * contract, then voids and restores it. Exercises record_payment,
 * void_payment, unvoid_payment. Cleaned up with the TEST contract.
 */
import { test, expect } from "@playwright/test";
import { authState, serviceClient, E2E_PREFIX } from "../../helpers";

test.describe("record", () => {
  test.use({ storageState: authState("admin") });

  test("admin records the downpayment", async ({ page }) => {
    await page.goto("/payments/new");
    await page.getByPlaceholder("Search name or contract no.…").fill(E2E_PREFIX);
    // Result rows are buttons; pick the TEST customer.
    await page.getByRole("button", { name: new RegExp(E2E_PREFIX) }).first().click();
    await page.locator('[name="amount"]').fill("250");
    await page.locator('[name="receipt_no"]').fill("E2E-TEST-OR-1");
    await page.getByRole("button", { name: "Record Payment" }).click();
    await page.waitForURL(/\/print\/receipt\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    // Receipt shows the amount.
    expect(await page.locator("body").innerText()).toContain("250");
  });
});

test.describe("void and restore (owner)", () => {
  test.use({ storageState: authState("owner") });

  test("owner voids then restores the TEST payment", async ({ page }) => {
    // Find the TEST payment's payment_no for button matching.
    const { data: contracts } = await serviceClient()
      .from("contracts")
      .select("id, customers!inner(last_name)")
      .ilike("customers.last_name", `${E2E_PREFIX}%`);
    test.skip(!contracts?.length, "TEST contract missing — run 10-contract first");
    const { data: payments } = await serviceClient()
      .from("payments")
      .select("id, payment_no")
      .eq("contract_id", contracts![0].id);
    test.skip(!payments?.length, "TEST payment missing — record step failed?");
    const payNo = payments![0].payment_no;

    await page.goto("/payments");
    // The row for our payment: find the Void button nearest the payment no.
    const row = page.locator("tr, li, div").filter({ hasText: payNo }).last();
    await row.getByRole("button", { name: "Void" }).click();
    await page.getByPlaceholder("e.g. duplicate entry, wrong amount").fill("E2E TEST void — will be restored");
    await page.getByRole("button", { name: `Void ${payNo}` }).click();

    // Voided state visible, then restore (native confirm).
    await expect(page.locator("body")).toContainText(/void/i);
    page.on("dialog", (d) => d.accept());
    const rowAfter = page.locator("tr, li, div").filter({ hasText: payNo }).last();
    await rowAfter.getByRole("button", { name: "Restore" }).click();

    // Verify restored in the database.
    await expect
      .poll(async () => {
        const { data } = await serviceClient()
          .from("payments")
          .select("voided_at")
          .eq("id", payments![0].id)
          .single();
        return data?.voided_at;
      })
      .toBeNull();
  });
});
