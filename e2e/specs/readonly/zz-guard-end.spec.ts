/**
 * Proves the read-only suite was actually read-only: no audit_log rows,
 * and no new rows in the write-heavy tables, were created by the test
 * accounts during the run. Real staff may write concurrently — that's
 * fine and ignored; only TEST-account writes fail the guard.
 */
import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { serviceClient, testUserId } from "../../helpers";

const GUARD_FILE = path.join(__dirname, "..", "..", ".auth", "readonly-guard.json");

test("no writes by test accounts during the read-only run", async () => {
  const { highWater } = JSON.parse(fs.readFileSync(GUARD_FILE, "utf8"));
  const testIds = (["OWNER", "ADMIN", "COLLECTOR", "AGENT", "DELIVERY"] as const).map(testUserId);

  const { data, error } = await serviceClient()
    .from("audit_log")
    .select("id, table_name, changed_by")
    .gt("id", highWater)
    .in("changed_by", testIds);
  expect(error).toBeNull();
  expect(data ?? [], "audit rows created by test accounts").toHaveLength(0);

  // Belt-and-braces: no E2E-prefixed rows exist in the tables the write
  // suite would touch (read-only runs must never leave any).
  for (const [table, col] of [
    ["customers", "last_name"],
    ["products", "name"],
    ["tasks", "title"],
    ["leads", "customer_name"],
  ] as const) {
    const { count } = await serviceClient()
      .from(table)
      .select("*", { count: "exact", head: true })
      .ilike(col, "E2E TEST%");
    expect(count ?? 0, `${table} has E2E TEST rows`).toBe(0);
  }
});
