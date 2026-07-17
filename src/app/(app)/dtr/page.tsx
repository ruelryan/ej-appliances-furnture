import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { fmtHours, monthLabel, peso, phTodayISO } from "@/lib/format";
import { btnSecondary } from "@/components/ui";
import { StatTile } from "@/components/stat-tile";
import { SectionCard } from "@/components/section-card";
import { ClockCard } from "./clock-card";
import { MonthGrid, type DtrDay, type Holiday } from "./month-grid";
import {
  CancelRequestButton,
  RequestSummary,
  ResolveRequestButtons,
  type CorrectionRequest,
} from "./correction-requests";

export const dynamic = "force-dynamic";

export default async function DtrPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; employee?: string }>;
}) {
  const { month: monthParam, employee } = await searchParams;
  const supabase = await createClient();
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const isOwner = profile.role === "owner";
  const todayISO = phTodayISO();
  const month = /^\d{4}-\d{2}$/.test(monthParam ?? "")
    ? (monthParam as string)
    : todayISO.slice(0, 7);
  const targetId = isOwner && employee ? employee : profile.id;

  const [y, mo] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to =
    mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
  const prevMonth =
    mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
  const nextMonth =
    mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  const employeeQS = isOwner && employee ? `&employee=${employee}` : "";

  const [
    daysRes,
    totalsRes,
    holsRes,
    todayRes,
    profilesRes,
    pendingDatesRes,
    requestsRes,
    geofenceRes,
  ] = await Promise.all([
      supabase
        .from("v_dtr_days")
        .select("*")
        .eq("profile_id", targetId)
        .gte("work_date", from)
        .lt("work_date", to)
        .order("work_date"),
      supabase
        .from("v_dtr_month")
        .select("*")
        .eq("profile_id", targetId)
        .eq("month", from)
        .maybeSingle(),
      supabase
        .from("holidays")
        .select("*")
        .gte("holiday_date", from)
        .lt("holiday_date", to),
      supabase
        .from("v_dtr_days")
        .select("time_in, time_out, hours_worked")
        .eq("profile_id", profile.id)
        .eq("work_date", todayISO)
        // exclude the synthetic unworked-holiday row — it has no punches
        .eq("is_unworked_holiday", false)
        .maybeSingle(),
      isOwner
        ? supabase
            .from("profiles")
            .select("id, full_name")
            .eq("active", true)
            .order("full_name")
        : Promise.resolve({ data: null }),
      // pending requests for the displayed month → "Requested" pills
      supabase
        .from("time_correction_requests")
        .select("work_date")
        .eq("profile_id", targetId)
        .eq("status", "pending")
        .gte("work_date", from)
        .lt("work_date", to),
      // owner: every pending request; staff: their own recent requests
      isOwner
        ? supabase
            .from("time_correction_requests")
            // two FKs to profiles (profile_id, resolved_by) — name the requester
            .select("*, profiles!profile_id(full_name)")
            .eq("status", "pending")
            .order("created_at")
        : supabase
            .from("time_correction_requests")
            .select("*")
            .eq("profile_id", profile.id)
            .order("created_at", { ascending: false })
            .limit(5),
      // any active geofence location? (controls the location prompt)
      supabase
        .from("dtr_locations")
        .select("id", { count: "exact", head: true })
        .eq("active", true),
    ]);

  const days = (daysRes.data ?? []) as DtrDay[];
  const holidays = (holsRes.data ?? []) as Holiday[];
  const totals = totalsRes.data as {
    days_worked: number;
    open_records: number;
    total_hours: string | number;
    total_pay: string | number | null;
    rate_missing: boolean;
  } | null;
  const employees = (profilesRes.data ?? []) as Array<{
    id: string;
    full_name: string;
  }>;
  const targetName = isOwner
    ? employees.find((e) => e.id === targetId)?.full_name ?? profile.full_name
    : profile.full_name;
  const rateMissing = totals ? totals.rate_missing : true;
  const pendingDates = (pendingDatesRes.data ?? []).map(
    (r: { work_date: string }) => r.work_date
  );
  const requests = (requestsRes.data ?? []).map((r) => ({
    ...r,
    employee_name: (r as { profiles?: { full_name: string } }).profiles
      ?.full_name,
  })) as CorrectionRequest[];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-ink">DTR</h1>
        <div className="flex gap-2">
          <Link href="/payroll" className={btnSecondary}>
            Payroll
          </Link>
          <Link
            href={`/print/dtr/${targetId}?month=${month}`}
            className={btnSecondary}
          >
            Print
          </Link>
          {isOwner && (
            <Link href="/dtr/settings" className={btnSecondary}>
              Settings
            </Link>
          )}
        </div>
      </div>

      <ClockCard
        today={todayRes.data ?? null}
        geofenceOn={(geofenceRes.count ?? 0) > 0}
      />

      {isOwner && requests.length > 0 && (
        <SectionCard
          title="Correction requests"
          sub="Approving applies the requested times to the day and logs the change."
        >
          <div className="divide-y divide-line">
            {requests.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <RequestSummary req={r} />
                <ResolveRequestButtons requestId={r.id} />
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {isOwner && (
        <form action="/dtr" method="get" className="flex gap-2">
          <input type="hidden" name="month" value={month} />
          <select
            name="employee"
            defaultValue={targetId}
            className="w-full rounded-card border border-line bg-white px-3 py-2.5 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
          >
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
          <button type="submit" className={btnSecondary}>
            View
          </button>
        </form>
      )}

      <div className="flex items-center justify-between rounded-card border border-line bg-white px-3 py-2">
        <Link
          href={`/dtr?month=${prevMonth}${employeeQS}`}
          className="rounded-card px-2 py-1 text-sm font-semibold text-brand hover:bg-brand/10"
        >
          ← {monthLabel(prevMonth)}
        </Link>
        <div className="text-sm font-semibold text-ink">
          {monthLabel(month)}
          {isOwner && <span className="text-muted"> · {targetName}</span>}
        </div>
        <Link
          href={`/dtr?month=${nextMonth}${employeeQS}`}
          className="rounded-card px-2 py-1 text-sm font-semibold text-brand hover:bg-brand/10"
        >
          {monthLabel(nextMonth)} →
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatTile
          label="Days worked"
          value={String(totals?.days_worked ?? 0)}
        />
        <StatTile
          label="Total hours"
          value={fmtHours(totals?.total_hours ?? 0)}
        />
        <StatTile
          label="Total pay"
          value={
            rateMissing || totals?.total_pay == null
              ? "—"
              : peso(totals.total_pay)
          }
        />
      </div>

      {totals != null && totals.open_records > 0 && (
        <p className="rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">
          {totals.open_records} day(s) with a missing clock-out — hours and pay
          for those days are not counted{isOwner ? " until corrected." : ". Ask the owner to correct them."}
        </p>
      )}

      {rateMissing && isOwner && (
        <p className="rounded-card bg-warning-bg px-3 py-2 text-xs text-warning">
          No hourly rate set for {targetName} — pay can&apos;t be computed.{" "}
          <Link href="/dtr/settings" className="font-semibold underline">
            Set it in Settings.
          </Link>
        </p>
      )}

      <MonthGrid
        month={month}
        days={days}
        holidays={holidays}
        isOwner={isOwner}
        canRequest={!isOwner}
        pendingDates={pendingDates}
        profileId={targetId}
        todayISO={todayISO}
        showPay={!rateMissing}
      />

      {!isOwner && requests.length > 0 && (
        <SectionCard
          title="My correction requests"
          sub="The owner reviews these; approved times appear in your record."
        >
          <div className="divide-y divide-line">
            {requests.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <RequestSummary req={r} />
                {r.status === "pending" ? (
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-warning-bg px-2 py-0.5 text-[10px] font-semibold text-warning">
                      Pending
                    </span>
                    <CancelRequestButton requestId={r.id} />
                  </div>
                ) : (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      r.status === "approved"
                        ? "bg-positive/10 text-positive-dark"
                        : "bg-danger-bg text-danger"
                    }`}
                  >
                    {r.status === "approved" ? "Approved" : "Rejected"}
                  </span>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <p className="text-xs text-muted">
        Hours exclude the 12:00–1:00 PM lunch hour. Worked regular holidays
        pay double; special non-working days pay +30%. An unworked regular
        holiday pays one day (8 hrs) when it falls on a weekday — weekend
        holidays are not paid unless worked.
      </p>
    </div>
  );
}
