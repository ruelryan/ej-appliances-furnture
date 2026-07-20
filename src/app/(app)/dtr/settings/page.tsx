import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { fmtDateShort, phTodayISO } from "@/lib/format";
import { SectionCard } from "@/components/section-card";
import { BackLink } from "@/components/back-link";
import { theadRow } from "@/components/ui";
import { RateForm } from "./rate-form";
import { ContributionsForm } from "./contributions-form";
import { DeleteHolidayButton, HolidayForm } from "./holiday-form";
import {
  DeleteLocationButton,
  LocationActiveToggle,
  LocationForm,
} from "./location-form";

export const dynamic = "force-dynamic";

export default async function DtrSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const profile = await getProfile();
  if (profile?.role !== "owner") redirect("/");

  const { year: yearParam } = await searchParams;
  const currentYear = Number(phTodayISO().slice(0, 4));
  const year = /^\d{4}$/.test(yearParam ?? "")
    ? Number(yearParam)
    : currentYear;

  const supabase = await createClient();
  const [profilesRes, ratesRes, holidaysRes, locationsRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("active", true)
      .order("full_name"),
    supabase.from("employee_rates").select("*"),
    supabase
      .from("holidays")
      .select("*")
      .gte("holiday_date", `${year}-01-01`)
      .lte("holiday_date", `${year}-12-31`)
      .order("holiday_date"),
    supabase.from("dtr_locations").select("*").order("created_at"),
  ]);

  const employees = profilesRes.data ?? [];
  const rateRows = ratesRes.data ?? [];
  const rateById = new Map(rateRows.map((r) => [r.id, r.hourly_rate]));
  const contribById = new Map(
    rateRows.map((r) => [
      r.id,
      {
        philhealthEe: String(Number(r.philhealth_ee ?? 0)),
        philhealthEr: String(Number(r.philhealth_er ?? 0)),
        sssEe: String(Number(r.sss_ee ?? 0)),
        sssEr: String(Number(r.sss_er ?? 0)),
        pagibigEe: String(Number(r.pagibig_ee ?? 0)),
        pagibigEr: String(Number(r.pagibig_er ?? 0)),
      },
    ])
  );
  const holidays = holidaysRes.data ?? [];
  const locations = (locationsRes.data ?? []) as Array<{
    id: string;
    name: string;
    lat: number;
    lng: number;
    radius_m: number;
    active: boolean;
  }>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BackLink />
        <h1 className="text-xl font-semibold text-ink">DTR settings</h1>
      </div>

      <SectionCard
        title="Hourly rates"
        sub="Used to compute pay from recorded hours. Rate changes are saved to the audit log."
      >
        <div className="divide-y divide-line">
          {employees.map((e) => (
            <div
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-2 py-3"
            >
              <div className="font-semibold text-ink">{e.full_name}</div>
              <RateForm
                profileId={e.id}
                currentRate={rateById.get(e.id) ?? null}
              />
            </div>
          ))}
          {employees.length === 0 && (
            <p className="py-8 text-center text-sm text-muted">
              No active employees.
            </p>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Monthly contributions"
        sub="Fixed monthly amounts per employee. The EE (employee) share is deducted on the 16–end payslip; the ER (employer) share is yours, shown on the slip for records. Changes don't affect already-created payslips."
      >
        <div className="divide-y divide-line">
          {employees.map((e) => (
            <div key={e.id} className="py-3">
              <div className="mb-2 font-semibold text-ink">{e.full_name}</div>
              {rateById.has(e.id) ? (
                <ContributionsForm
                  profileId={e.id}
                  current={
                    contribById.get(e.id) ?? {
                      philhealthEe: "0",
                      philhealthEr: "0",
                      sssEe: "0",
                      sssEr: "0",
                      pagibigEe: "0",
                      pagibigEr: "0",
                    }
                  }
                />
              ) : (
                <p className="text-xs text-muted">
                  Set the hourly rate above first.
                </p>
              )}
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Office location (geofence)"
        sub="When at least one location here is turned on, staff can clock in/out only within its radius — punches from anywhere else are blocked, and staff on deliveries file a time correction request instead. No active locations = geofence off. Note: phone GPS can be faked by a determined user, so treat this as a strong deterrent and audit trail, not absolute proof."
      >
        <div className="mb-4">
          <LocationForm />
        </div>

        <div className="divide-y divide-line">
          {locations.map((l) => (
            <div
              key={l.id}
              className="flex flex-wrap items-center justify-between gap-2 py-3"
            >
              <div className="min-w-0">
                <div className="font-semibold text-ink">
                  {l.name}{" "}
                  <span
                    className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      l.active
                        ? "bg-positive/10 text-positive-dark"
                        : "bg-line text-muted"
                    }`}
                  >
                    {l.active ? "On" : "Off"}
                  </span>
                </div>
                <div className="text-xs tabular-nums text-muted">
                  {l.lat}, {l.lng} · {l.radius_m} m radius
                </div>
              </div>
              <div className="flex gap-2">
                <LocationActiveToggle id={l.id} active={l.active} />
                <DeleteLocationButton id={l.id} name={l.name} />
              </div>
            </div>
          ))}
          {locations.length === 0 && (
            <p className="py-6 text-center text-sm text-muted">
              No locations yet — geofence is off. Add the store above to turn
              it on (get coordinates from Google Maps: press and hold on the
              store, the numbers appear in the search box).
            </p>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title={`Holidays · ${year}`}
        sub="Fixed and Holy Week holidays up to 2030 are pre-loaded. Malacañang's yearly proclamation moves or adds dates — add Eid'l Fitr, Eid'l Adha, and Chinese New Year here when proclaimed, and adjust anything that changed."
        action={
          <div className="flex gap-1 text-sm font-semibold">
            <Link
              href={`/dtr/settings?year=${year - 1}`}
              className="rounded-card px-2 py-1 text-brand hover:bg-brand/10"
            >
              ← {year - 1}
            </Link>
            <Link
              href={`/dtr/settings?year=${year + 1}`}
              className="rounded-card px-2 py-1 text-brand hover:bg-brand/10"
            >
              {year + 1} →
            </Link>
          </div>
        }
      >
        <div className="mb-4">
          <HolidayForm />
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className={theadRow}>
              <th className="py-2 pr-3 font-medium">Date</th>
              <th className="py-2 pr-3 font-medium">Holiday</th>
              <th className="py-2 pr-3 font-medium">Type</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {holidays.map((h) => (
              <tr key={h.holiday_date} className="border-b border-line last:border-b-0">
                <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-ink">
                  {fmtDateShort(h.holiday_date)}
                </td>
                <td className="py-2 pr-3 text-ink">{h.name}</td>
                <td className="py-2 pr-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      h.type === "regular"
                        ? "bg-warning-bg text-warning"
                        : "bg-brand/10 text-brand"
                    }`}
                  >
                    {h.type === "regular" ? "Regular" : "Special"}
                  </span>
                </td>
                <td className="py-2 text-right">
                  <DeleteHolidayButton date={h.holiday_date} name={h.name} />
                </td>
              </tr>
            ))}
            {holidays.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-sm text-muted">
                  No holidays for {year} yet — add them above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </SectionCard>

      <p className="text-xs text-muted">
        Pay rules: worked regular holiday ×2.00 · worked special day ×1.30 ·
        unworked regular holiday on a weekday = one day&apos;s pay (8 hrs;
        weekend holidays unpaid unless worked) · unworked special day = no
        pay.
      </p>
    </div>
  );
}
