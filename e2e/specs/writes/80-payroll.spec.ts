/**
 * WRITE SPEC — payroll draft lifecycle for the TEST collector: set an
 * hourly rate (service-side, employee_rates cascades away at teardown),
 * create a draft payslip for the last completed period, render its print
 * page, then DELETE the draft in-spec (payroll self-cleans; finalize and
 * 13th-month are deliberately never tested).
 */
import { test, expect } from "@playwright/test";
import { authState, serviceClient, testUserId } from "../../helpers";

test.use({ storageState: authState("owner") });

test("create, print, delete a draft payslip", async ({ page }) => {
  // Rate for the TEST collector (upsert — rerun-safe).
  const { error: rateErr } = await serviceClient()
    .from("employee_rates")
    .upsert({ id: testUserId("COLLECTOR"), hourly_rate: 56.25 });
  expect(rateErr).toBeNull();

  await page.goto("/payroll");
  const employeeSelect = page
    .locator("select")
    .filter({ has: page.locator("option", { hasText: "E2E TEST — DO NOT USE (Collector)" }) })
    .first();
  const opts = await employeeSelect.locator("option").allTextContents();
  const idx = opts.findIndex((o) => o.includes("E2E TEST — DO NOT USE (Collector)"));
  expect(idx, "TEST collector in the employee select").toBeGreaterThanOrEqual(0);
  await employeeSelect.selectOption({ index: idx });
  // Period select defaults are fine (latest completed period).
  await page.getByRole("button", { name: "Create payslip" }).click();
  await page.waitForURL(/\/payroll\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const slipId = page.url().split("/").pop()!;

  // Print page renders.
  const res = await page.goto(`/print/payslip/${slipId}`);
  expect(res!.status()).toBeLessThan(400);

  // Delete the draft (native confirm) — payroll leaves no residue.
  await page.goto(`/payroll/${slipId}`);
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete draft" }).click();
  await page.waitForURL(/\/payroll$/, { timeout: 30_000 });

  const { count } = await serviceClient()
    .from("payslips")
    .select("*", { count: "exact", head: true })
    .eq("id", slipId);
  expect(count ?? 0).toBe(0);
});
