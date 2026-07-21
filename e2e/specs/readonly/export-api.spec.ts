/**
 * /api/export/[dataset] is owner-only CSV. Read-only.
 */
import { test, expect } from "@playwright/test";
import { authState } from "../../helpers";

const DATASETS = ["contracts", "payments", "aging", "customers"];

test.describe("owner", () => {
  test.use({ storageState: authState("owner") });

  test("all four datasets return CSV", async ({ request }) => {
    for (const d of DATASETS) {
      const res = await request.get(`/api/export/${d}`);
      expect(res.status(), d).toBe(200);
      expect(res.headers()["content-type"], d).toContain("csv");
    }
  });
});

for (const role of ["admin", "collector"] as const) {
  test.describe(role, () => {
    test.use({ storageState: authState(role) });

    test("export is forbidden", async ({ request }) => {
      const res = await request.get("/api/export/contracts");
      expect(res.status()).toBe(403);
    });
  });
}

test.describe("unauthenticated", () => {
  test("export redirects to login", async ({ request }) => {
    const res = await request.get("/api/export/contracts");
    // Middleware redirects to /login; the request client follows it.
    expect(res.url()).toContain("/login");
  });
});
