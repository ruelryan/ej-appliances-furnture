/**
 * Print pages render for the owner with real record ids (read-only).
 * Pages whose dataset is empty are skipped, not failed.
 */
import { test, expect } from "@playwright/test";
import { authState, serviceClient } from "../../helpers";

test.use({ storageState: authState("owner") });

async function firstId(table: string, orderBy = "id"): Promise<string | null> {
  const { data } = await serviceClient().from(table).select("id").order(orderBy).limit(1);
  return data?.[0]?.id ?? null;
}

async function expectPrintRenders(page: import("@playwright/test").Page, url: string) {
  const res = await page.goto(url);
  expect(res!.status(), url).toBeLessThan(400);
  // Print layout has no app chrome; body must have real content.
  expect((await page.locator("body").innerText()).trim().length).toBeGreaterThan(50);
}

test("contract printout", async ({ page }) => {
  const id = await firstId("contracts");
  test.skip(!id, "no contracts");
  await expectPrintRenders(page, `/print/contract/${id}`);
});

test("payment receipt", async ({ page }) => {
  const id = await firstId("payments");
  test.skip(!id, "no payments");
  await expectPrintRenders(page, `/print/receipt/${id}`);
});

test("customer card", async ({ page }) => {
  const id = await firstId("customers");
  test.skip(!id, "no customers");
  await expectPrintRenders(page, `/print/customer-card/${id}`);
});

test("demand letter", async ({ page }) => {
  const id = await firstId("contracts");
  test.skip(!id, "no contracts");
  await expectPrintRenders(page, `/print/demand-letter/${id}`);
});

test("repricing amendment (skipped when none exist)", async ({ page }) => {
  const { data } = await serviceClient().from("contract_repricings").select("id").limit(1);
  test.skip(!data?.length, "no repricings recorded");
  await expectPrintRenders(page, `/print/amendment/${data![0].id}`);
});

test("payslip printout", async ({ page }) => {
  const id = await firstId("payslips");
  test.skip(!id, "no payslips");
  await expectPrintRenders(page, `/print/payslip/${id}`);
});

test("DTR timesheet printout", async ({ page }) => {
  const { data } = await serviceClient()
    .from("time_records")
    .select("profile_id")
    .order("id")
    .limit(1);
  test.skip(!data?.length, "no time records");
  await expectPrintRenders(page, `/print/dtr/${data![0].profile_id}`);
});

test("commission statement (skipped when none exist)", async ({ page }) => {
  const { data } = await serviceClient().from("commissions").select("agent_id").limit(1);
  test.skip(!data?.length, "no commissions recorded");
  await expectPrintRenders(page, `/print/commission-statement/${data![0].agent_id}`);
});
