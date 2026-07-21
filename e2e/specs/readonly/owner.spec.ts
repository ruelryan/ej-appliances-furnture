/**
 * Every app route renders for the owner (the least-restricted role) with
 * no server error and no unexpected redirect. Read-only — no form submits.
 */
import { test, expect } from "@playwright/test";
import { authState, serviceClient } from "../../helpers";

test.use({ storageState: authState("owner") });

const ROUTES = [
  "/",
  "/account",
  "/tasks",
  "/dtr",
  "/dtr/settings",
  "/contracts",
  "/contracts/new",
  "/payments",
  "/payments/new",
  "/collections",
  "/collections/report",
  "/collections/sop",
  "/deliveries",
  "/products",
  "/products/review",
  "/customers",
  "/commissions",
  "/leads",
  "/payroll",
  "/payroll/13th-month",
  "/analytics",
  "/admin",
];

for (const route of ROUTES) {
  test(`renders ${route}`, async ({ page }) => {
    const res = await page.goto(route);
    expect(res, `no response for ${route}`).toBeTruthy();
    expect(res!.status(), `HTTP status for ${route}`).toBeLessThan(400);
    await expect(page).toHaveURL(new RegExp(`${route.replace(/[/\\]/g, "\\$&")}$`));
    // The app shell rendered (top bar sign-out is on every (app) page).
    await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
  });
}

test("renders a contract detail page with live financials", async ({ page }) => {
  const { data } = await serviceClient()
    .from("contracts")
    .select("id")
    .order("contract_no", { ascending: false })
    .limit(1);
  test.skip(!data?.length, "no contracts in database");
  const res = await page.goto(`/contracts/${data![0].id}`);
  expect(res!.status()).toBeLessThan(400);
  await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
});

test("renders a customer detail page", async ({ page }) => {
  const { data } = await serviceClient().from("customers").select("id").order("id").limit(1);
  test.skip(!data?.length, "no customers in database");
  const res = await page.goto(`/customers/${data![0].id}`);
  expect(res!.status()).toBeLessThan(400);
  await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
});
