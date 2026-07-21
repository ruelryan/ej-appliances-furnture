/**
 * WRITE SPEC — repossession stage round-trip on the TEST contract:
 * none → letter_prepared → none. Owner-only control; fully reversible.
 */
import { test, expect } from "@playwright/test";
import { authState, serviceClient, E2E_PREFIX } from "../../helpers";

test.use({ storageState: authState("owner") });

test("owner sets and reverts the repossession stage", async ({ page }) => {
  const { data: contracts } = await serviceClient()
    .from("contracts")
    .select("id, customers!inner(last_name)")
    .ilike("customers.last_name", `${E2E_PREFIX}%`);
  test.skip(!contracts?.length, "TEST contract missing");
  const id = contracts![0].id;

  await page.goto(`/contracts/${id}`);
  await page.getByRole("button", { name: "Demand letter prepared" }).click();
  await expect
    .poll(async () => {
      const { data } = await serviceClient().from("contracts").select("repossession_stage").eq("id", id).single();
      return data?.repossession_stage;
    })
    .toBe("letter_prepared");

  await page.getByRole("button", { name: "Not in repossession" }).click();
  await expect
    .poll(async () => {
      const { data } = await serviceClient().from("contracts").select("repossession_stage").eq("id", id).single();
      return data?.repossession_stage;
    })
    .toBe("none");
});
