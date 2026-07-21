/**
 * Records the audit_log high-water mark before the read-only suite runs.
 * zz-guard-end.spec.ts verifies the suite itself wrote nothing.
 * (Files run alphabetically with workers: 1, so aa- runs first, zz- last.)
 */
import fs from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { auditHighWater } from "../../helpers";

export const GUARD_FILE = path.join(__dirname, "..", "..", ".auth", "readonly-guard.json");

test("record audit_log high-water mark", async () => {
  const highWater = await auditHighWater();
  fs.writeFileSync(GUARD_FILE, JSON.stringify({ highWater }));
});
