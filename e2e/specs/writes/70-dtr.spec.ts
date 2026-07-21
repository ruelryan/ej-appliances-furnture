/**
 * WRITE SPEC — DTR clock in/out for the TEST collector. The geofence is
 * enforced server-side against active dtr_locations rows; we stub browser
 * geolocation to the first active row's coordinates (or Manila if the
 * geofence table is empty — geofence off). One block per day: skips if
 * the test collector already punched today. time_records rows are
 * removed by cleanup-test-data.ts.
 */
import { test, expect } from "@playwright/test";
import { authState, serviceClient, testUserId } from "../../helpers";

test.use({
  storageState: authState("collector"),
  permissions: ["geolocation"],
  geolocation: { latitude: 14.5995, longitude: 120.9842 }, // placeholder; set per-run below
});

test("collector clocks in and out", async ({ page, context }) => {
  // Skip if already punched today (Manila date).
  const manilaToday = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const { count } = await serviceClient()
    .from("time_records")
    .select("*", { count: "exact", head: true })
    .eq("profile_id", testUserId("COLLECTOR"))
    .eq("work_date", manilaToday);
  test.skip((count ?? 0) > 0, "already punched today — one block per day; run cleanup first");

  // Aim the stubbed GPS at the active geofence location, if any.
  const { data: fence } = await serviceClient()
    .from("dtr_locations")
    .select("lat, lng, active")
    .eq("active", true)
    .limit(1);
  if (fence?.length) {
    await context.setGeolocation({ latitude: fence[0].lat, longitude: fence[0].lng });
  }

  await page.goto("/dtr");
  await page.getByRole("button", { name: "Clock In" }).click();
  await expect(page.getByText(/Clocked in at/)).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Clock Out" }).click();
  await expect(page.getByText(/hrs today/)).toBeVisible({ timeout: 30_000 });

  const { data: rec } = await serviceClient()
    .from("time_records")
    .select("time_in, time_out")
    .eq("profile_id", testUserId("COLLECTOR"))
    .eq("work_date", manilaToday)
    .single();
  expect(rec?.time_in).toBeTruthy();
  expect(rec?.time_out).toBeTruthy();
});
