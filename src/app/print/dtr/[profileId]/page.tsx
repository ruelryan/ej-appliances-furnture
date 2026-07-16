import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  fmtHours,
  fmtTime,
  monthLabel,
  peso,
  phTodayISO,
} from "@/lib/format";
import { Letterhead, SignatureBlocks } from "../../letterhead";
import { PrintControls } from "../../print-controls";

export const dynamic = "force-dynamic";

type DtrDay = {
  work_date: string;
  record_id: string | null;
  time_in: string | null;
  time_out: string | null;
  hours_worked: string | number | null;
  holiday_name: string | null;
  holiday_type: "regular" | "special" | null;
  day_pay: string | number | null;
  is_unworked_holiday: boolean;
};

export default async function PrintDtrPage({
  params,
  searchParams,
}: {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { profileId } = await params;
  const { month: monthParam } = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(monthParam ?? "")
    ? (monthParam as string)
    : phTodayISO().slice(0, 7);

  const supabase = await createClient();

  const [y, mo] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to =
    mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;

  const [profileRes, daysRes, totalsRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("id", profileId)
      .maybeSingle(),
    supabase
      .from("v_dtr_days")
      .select("*")
      .eq("profile_id", profileId)
      .gte("work_date", from)
      .lt("work_date", to)
      .order("work_date"),
    supabase
      .from("v_dtr_month")
      .select("*")
      .eq("profile_id", profileId)
      .eq("month", from)
      .maybeSingle(),
  ]);

  if (!profileRes.data) notFound();
  const employee = profileRes.data;
  const days = (daysRes.data ?? []) as DtrDay[];
  const totals = totalsRes.data as {
    total_hours: string | number;
    total_pay: string | number | null;
    days_worked: number;
    rate_missing: boolean;
  } | null;
  const showPay = totals != null && !totals.rate_missing;

  const byDate = new Map(days.map((d) => [d.work_date, d]));
  const daysInMonth = new Date(y, mo, 0).getDate();

  return (
    <div className="text-sm">
      <PrintControls
        filename={`dtr-${employee.full_name.replace(/\W+/g, "-")}-${month}`}
      />
      <Letterhead />
      <h1 className="mb-1 text-center text-base font-semibold">
        DAILY TIME RECORD
      </h1>
      <div className="mb-4 text-center text-xs">
        <span className="font-semibold">{employee.full_name}</span> ·{" "}
        {monthLabel(month)}
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="border-b-2 border-ink text-left">
            <th className="py-1 pr-2 font-semibold">Date</th>
            <th className="py-1 pr-2 font-semibold">Time in</th>
            <th className="py-1 pr-2 font-semibold">Time out</th>
            <th className="py-1 pr-2 text-right font-semibold">Hours</th>
            <th className="py-1 pr-2 font-semibold">Holiday</th>
            {showPay && <th className="py-1 text-right font-semibold">Pay</th>}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: daysInMonth }, (_, i) => {
            const dayNo = i + 1;
            const iso = `${month}-${String(dayNo).padStart(2, "0")}`;
            const row = byDate.get(iso);
            const weekday = new Date(y, mo - 1, dayNo).toLocaleDateString(
              "en-PH",
              { weekday: "short" }
            );
            return (
              <tr key={iso} className="border-b border-line">
                <td className="py-1 pr-2 tabular-nums">
                  {weekday} {dayNo}
                </td>
                <td className="py-1 pr-2 tabular-nums">
                  {row?.time_in ? fmtTime(row.time_in) : ""}
                </td>
                <td className="py-1 pr-2 tabular-nums">
                  {row?.time_out ? fmtTime(row.time_out) : ""}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {row && !row.is_unworked_holiday && row.hours_worked != null
                    ? fmtHours(row.hours_worked)
                    : ""}
                </td>
                <td className="py-1 pr-2">
                  {row?.holiday_name ?? ""}
                  {row?.is_unworked_holiday ? " (unworked)" : ""}
                </td>
                {showPay && (
                  <td className="py-1 text-right tabular-nums">
                    {row?.day_pay != null ? peso(row.day_pay) : ""}
                  </td>
                )}
              </tr>
            );
          })}
          <tr>
            <td colSpan={3} className="py-2 pr-2 font-semibold">
              Total — {totals?.days_worked ?? 0} day(s) worked
            </td>
            <td className="py-2 pr-2 text-right font-semibold tabular-nums">
              {fmtHours(totals?.total_hours ?? 0)}
            </td>
            <td />
            {showPay && (
              <td className="py-2 text-right font-semibold tabular-nums">
                {totals?.total_pay != null ? peso(totals.total_pay) : ""}
              </td>
            )}
          </tr>
        </tbody>
      </table>

      <p className="mt-2 text-[10px] text-muted">
        Hours exclude the 12:00–1:00 PM lunch break. Regular holidays worked
        are paid ×2.00; special non-working days worked ×1.30; unworked
        regular holidays falling on a weekday are paid one day (8 hrs).
      </p>

      <SignatureBlocks left={employee.full_name} right="Owner / Manager" />
    </div>
  );
}
