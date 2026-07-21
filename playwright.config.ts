import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.e2e" });

/**
 * E2E suite for the E & J app. READ THIS BEFORE CHANGING:
 *
 * There is NO test database — everything runs against production data
 * through a local dev server. workers: 1 and retries: 0 are load-bearing:
 * a retried or concurrent write spec would double-write to the live
 * business database. Never turn on retries or parallelism here.
 *
 * Read-only suite:  npm run e2e:readonly   (safe any time)
 * Write suite:      npm run e2e:writes     (evenings only; see docs/testing.md
 *                   for the backup → run → cleanup → teardown procedure)
 */
export default defineConfig({
  testDir: "e2e/specs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  globalSetup: "./e2e/global-setup",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
