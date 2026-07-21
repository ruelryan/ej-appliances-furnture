/**
 * WRITE SPEC — task lifecycle: owner creates a task assigned BY PERSON to
 * the TEST collector (never by role — role assignment broadcasts to real
 * staff), collector comments and completes it. Cleaned up by title prefix.
 */
import { test, expect } from "@playwright/test";
import { authState, serviceClient, E2E_PREFIX } from "../../helpers";

const TASK_TITLE = `${E2E_PREFIX} task — ignore, auto-deleted`;

test.describe("create", () => {
  test.use({ storageState: authState("owner") });

  test("owner creates a person-assigned task", async ({ page }) => {
    await page.goto("/tasks");
    await page.getByRole("button", { name: "New task" }).click();
    await page.getByPlaceholder("What needs doing?").fill(TASK_TITLE);
    // Person mode is the default; pick the TEST collector.
    const personSelect = page
      .locator("select")
      .filter({ has: page.locator("option", { hasText: "E2E TEST — DO NOT USE (Collector)" }) })
      .first();
    const opts = await personSelect.locator("option").allTextContents();
    const idx = opts.findIndex((o) => o.includes("E2E TEST — DO NOT USE (Collector)"));
    expect(idx, "TEST collector in the person select").toBeGreaterThanOrEqual(0);
    await personSelect.selectOption({ index: idx });
    await page.getByRole("button", { name: "Create task" }).click();

    await expect
      .poll(async () => {
        const { count } = await serviceClient()
          .from("tasks")
          .select("*", { count: "exact", head: true })
          .eq("title", TASK_TITLE);
        return count;
      })
      .toBe(1);
  });
});

test.describe("work it", () => {
  test.use({ storageState: authState("collector") });

  test("collector sees, comments on, and completes the task", async ({ page }) => {
    const { data: tasks } = await serviceClient().from("tasks").select("id").eq("title", TASK_TITLE);
    test.skip(!tasks?.length, "TEST task missing — create step failed?");

    await page.goto("/tasks");
    await expect(page.getByText(TASK_TITLE).first()).toBeVisible();
    await page.goto(`/tasks/${tasks![0].id}`);

    await page.getByPlaceholder("Write a comment…").fill(`${E2E_PREFIX} comment`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(`${E2E_PREFIX} comment`).first()).toBeVisible();

    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect
      .poll(async () => {
        const { data } = await serviceClient().from("tasks").select("status").eq("id", tasks![0].id).single();
        return data?.status;
      })
      .toBe("done");
  });
});
