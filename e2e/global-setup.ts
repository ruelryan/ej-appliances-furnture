/**
 * Logs in each of the five E2E test accounts through the real /login form
 * and saves a storage state per role to e2e/.auth/<role>.json.
 *
 * Requires .env.e2e (created by scripts/e2e/setup-test-users.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type FullConfig } from "@playwright/test";

const ROLES = [
  { role: "owner", key: "OWNER" },
  { role: "admin", key: "ADMIN" },
  { role: "collector", key: "COLLECTOR" },
  { role: "sales_agent", key: "AGENT" },
  { role: "delivery", key: "DELIVERY" },
] as const;

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL ?? "http://localhost:3000";
  const authDir = path.join(__dirname, ".auth");
  fs.mkdirSync(authDir, { recursive: true });

  const browser = await chromium.launch();
  for (const { role, key } of ROLES) {
    const email = process.env[`E2E_${key}_EMAIL`];
    const password = process.env[`E2E_${key}_PASSWORD`];
    if (!email || !password) {
      throw new Error(
        `Missing E2E_${key}_EMAIL/PASSWORD — run scripts/e2e/setup-test-users.ts --apply first.`
      );
    }
    const statePath = path.join(authDir, `${role}.json`);
    const page = await browser.newPage({ baseURL });
    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.getByRole("button", { name: "Sign in" }).click();
    // Landing page differs per role (sales_agent → /commissions,
    // delivery → /deliveries) — only assert we left /login. First compile
    // of a route on the dev server can take a while, hence the long wait.
    try {
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
        timeout: 90_000,
      });
    } catch (e) {
      const errorText = await page
        .locator("p.rounded-card")
        .textContent()
        .catch(() => null);
      throw new Error(
        `Login as ${role} (${email}) did not navigate. ` +
          (errorText ? `Form error: "${errorText}"` : "No form error shown — likely a slow/failed server.")
      );
    }
    await page.context().storageState({ path: statePath });
    await page.close();
    console.log(`  logged in ${role} (${email})`);
  }
  await browser.close();
}
