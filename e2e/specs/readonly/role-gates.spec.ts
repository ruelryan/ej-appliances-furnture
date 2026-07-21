/**
 * Role gates, matched to the ACTUAL page-level redirects in src/app.
 * Pages with no redirect gate (/payments, /customers, /contracts, /tasks,
 * /dtr, /payroll, /account) render for every authenticated role and rely
 * on RLS to scope rows — for those we assert nav hiding instead.
 */
import { test, expect } from "@playwright/test";
import { authState } from "../../helpers";

async function expectRedirect(page: import("@playwright/test").Page, from: string, to: RegExp) {
  await page.goto(from);
  await expect(page).toHaveURL(to);
}

test.describe("admin", () => {
  test.use({ storageState: authState("admin") });

  test("owner-only routes redirect home", async ({ page }) => {
    for (const r of ["/analytics", "/admin", "/dtr/settings", "/payroll/13th-month"]) {
      await expectRedirect(page, r, /\/$/);
    }
  });

  test("nav hides owner-only links", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation").first();
    await expect(nav.getByRole("link", { name: "Analytics" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Admin" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Payments" }).first()).toBeVisible();
  });
});

test.describe("collector", () => {
  test.use({ storageState: authState("collector") });

  test("blocked routes redirect home", async ({ page }) => {
    for (const r of [
      "/analytics",
      "/admin",
      "/dtr/settings",
      "/payroll/13th-month",
      "/products",
      "/products/review",
      "/deliveries",
      "/commissions",
      "/leads",
    ]) {
      await expectRedirect(page, r, /\/$/);
    }
  });

  test("collections worklist and SOP are allowed", async ({ page }) => {
    await page.goto("/collections");
    await expect(page).toHaveURL(/\/collections$/);
    await page.goto("/collections/sop");
    await expect(page).toHaveURL(/\/collections\/sop$/);
  });

  test("nav hides admin links", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation").first();
    await expect(nav.getByRole("link", { name: "Payments" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Products" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Collect" }).first()).toBeVisible();
  });
});

test.describe("sales_agent", () => {
  test.use({ storageState: authState("sales_agent") });

  test("dashboard redirects to commissions", async ({ page }) => {
    await expectRedirect(page, "/", /\/commissions$/);
  });

  test("blocked routes redirect away", async ({ page }) => {
    for (const r of ["/collections", "/deliveries", "/products", "/analytics", "/admin"]) {
      await page.goto(r);
      // "/" itself bounces agents onward to /commissions.
      await expect(page).toHaveURL(/\/(commissions)?$/);
    }
  });

  test("commissions and leads are allowed", async ({ page }) => {
    await page.goto("/commissions");
    await expect(page).toHaveURL(/\/commissions$/);
    await page.goto("/leads");
    await expect(page).toHaveURL(/\/leads$/);
  });
});

test.describe("delivery", () => {
  test.use({ storageState: authState("delivery") });

  test("dashboard redirects to deliveries", async ({ page }) => {
    await expectRedirect(page, "/", /\/deliveries$/);
  });

  test("blocked routes redirect away", async ({ page }) => {
    for (const r of ["/collections", "/commissions", "/leads", "/products", "/analytics", "/admin"]) {
      await page.goto(r);
      await expect(page).toHaveURL(/\/(deliveries)?$/);
    }
  });
});

test.describe("owner-only edit page", () => {
  test.use({ storageState: authState("admin") });

  test("contract edit bounces non-owners back to the contract", async ({ page }) => {
    await page.goto("/contracts");
    const firstContract = page.locator('a[href^="/contracts/"]').first();
    await firstContract.waitFor();
    const href = await firstContract.getAttribute("href");
    test.skip(!href, "no contract links on the list page");
    await page.goto(`${href}/edit`);
    await expect(page).toHaveURL(new RegExp(`${href!.replace(/[/\\]/g, "\\$&")}$`));
  });
});
