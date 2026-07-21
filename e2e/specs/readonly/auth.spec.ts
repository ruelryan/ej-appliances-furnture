/**
 * Auth gate: unauthenticated redirects, health endpoint, bad login,
 * logged-in /login bounce. Read-only.
 */
import { test, expect } from "@playwright/test";
import { authState } from "../../helpers";

test.describe("unauthenticated", () => {
  test("protected routes redirect to /login", async ({ page }) => {
    for (const route of ["/", "/contracts", "/admin", "/payments"]) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test("/api/health responds 200 without auth", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
  });

  test("wrong password shows the generic error", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#email", "test-owner@eandj.test");
    await page.fill("#password", "definitely-wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid email or password")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("authenticated", () => {
  test.use({ storageState: authState("owner") });

  test("visiting /login while signed in bounces home", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/$/);
  });
});
