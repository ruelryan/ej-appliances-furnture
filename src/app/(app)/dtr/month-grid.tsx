import { fmtHours, fmtTime, peso } from "@/lib/format";
import { theadRow } from "@/components/ui";
import { EditRecordDialog } from "./edit-record-dialog";
import { RequestFixDialog } from "./request-fix-dialog";

// Row shape of v_dtr_days (all math done in SQL).
export type DtrDay = {
  profile_id: string;
  work_date: string;
  record_id: string | null;
  time_in: string | null;
  time_out: string | null;
  note: string | null;
  hours_worked: string | number | null;
  holiday_name: string | null;
  holiday_type: "regular" | "special" | null;
  multiplier: string | number;
  hourly_rate: string | number | null;
  day_pay: string | number | null;
  is_unworked_holiday: boolean;
};

export type Holiday = {
  holiday_date: string;
  name: string;
  type: "regular" | "special";
};

function HolidayPill({
  name,
  type,
}: {
  name: string;
  type: "regular" | "special";
}) {
  return (
    <span
      className={`inline-block max-w-full truncate rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        type === "regular"
          ? "bg-warning-bg text-warning"
          : "bg-brand/10 text-brand"
      }`}
      title={`${name} — ${type === "regular" ? "Regular holiday (×2 when worked)" : "Special non-working day (×1.3 when worked)"}`}
    >
      {name}
    </span>
  );
}

// Presentational only: the calendar spine is built in TS for display; every
// number shown comes from the v_dtr_days view.
export function MonthGrid({
  month,
  days,
  holidays,
  isOwner,
  canRequest = false,
  pendingDates = [],
  profileId,
  todayISO,
  showPay,
}: {
  month: string; // "YYYY-MM"
  days: DtrDay[];
  holidays: Holiday[];
  isOwner: boolean;
  canRequest?: boolean; // staff viewing their own grid
  pendingDates?: string[]; // dates with a pending correction request
  profileId: string;
  todayISO: string;
  showPay: boolean;
}) {
  const [y, mo] = month.split("-").map(Number);
  const daysInMonth = new Date(y, mo, 0).getDate();
  const byDate = new Map(days.map((d) => [d.work_date, d]));
  const holidayByDate = new Map(holidays.map((h) => [h.holiday_date, h]));
  const pendingSet = new Set(pendingDates);
  const hasActions = isOwner || canRequest;

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className={theadRow}>
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-2 py-2 font-medium">In</th>
            <th className="px-2 py-2 font-medium">Out</th>
            <th className="px-2 py-2 text-right font-medium">Hours</th>
            {showPay && (
              <th className="px-2 py-2 text-right font-medium">Pay</th>
            )}
            {hasActions && <th className="px-2 py-2" />}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: daysInMonth }, (_, i) => {
            const dayNo = i + 1;
            const iso = `${month}-${String(dayNo).padStart(2, "0")}`;
            const row = byDate.get(iso);
            const holiday =
              row?.holiday_name && row.holiday_type
                ? { name: row.holiday_name, type: row.holiday_type }
                : holidayByDate.get(iso) ?? null;
            const date = new Date(y, mo - 1, dayNo);
            const weekday = date.toLocaleDateString("en-PH", {
              weekday: "short",
            });
            const isSunday = date.getDay() === 0;
            const isToday = iso === todayISO;
            const missingOut =
              row?.record_id && !row.time_out && iso !== todayISO;
            const working = row?.record_id && !row.time_out && iso === todayISO;

            return (
              <tr
                key={iso}
                className={`border-b border-line last:border-b-0 ${
                  isSunday ? "bg-surface/60" : ""
                }`}
              >
                <td className="px-3 py-2">
                  <div
                    className={`whitespace-nowrap tabular-nums ${
                      isToday ? "font-semibold text-brand" : "text-ink"
                    }`}
                  >
                    {weekday} {dayNo}
                  </div>
                  {holiday && (
                    <HolidayPill name={holiday.name} type={holiday.type} />
                  )}
                  {row?.note && (
                    <div className="max-w-40 truncate text-[10px] text-muted">
                      {row.note}
                    </div>
                  )}
                </td>
                <td className="px-2 py-2 whitespace-nowrap tabular-nums text-ink">
                  {row?.time_in ? fmtTime(row.time_in) : "—"}
                </td>
                <td className="px-2 py-2 whitespace-nowrap tabular-nums text-ink">
                  {working ? (
                    <span className="rounded-full bg-positive/10 px-2 py-0.5 text-[10px] font-semibold text-positive-dark">
                      Working
                    </span>
                  ) : missingOut ? (
                    <span className="rounded-full bg-danger-bg px-2 py-0.5 text-[10px] font-semibold text-danger">
                      Missing out
                    </span>
                  ) : row?.time_out ? (
                    fmtTime(row.time_out)
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-ink">
                  {row?.is_unworked_holiday ? (
                    <span
                      className="text-muted"
                      title="Unworked regular holiday — paid one day (8 hrs)"
                    >
                      —
                    </span>
                  ) : (
                    fmtHours(row?.hours_worked ?? null)
                  )}
                </td>
                {showPay && (
                  <td className="px-2 py-2 text-right tabular-nums text-ink">
                    {row?.day_pay != null ? peso(row.day_pay) : "—"}
                  </td>
                )}
                {hasActions && (
                  <td className="px-2 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {pendingSet.has(iso) && (
                        <span className="rounded-full bg-warning-bg px-2 py-0.5 text-[10px] font-semibold text-warning">
                          Requested
                        </span>
                      )}
                      {isOwner ? (
                        <EditRecordDialog
                          profileId={profileId}
                          workDate={iso}
                          dateLabel={date.toLocaleDateString("en-PH", {
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                          })}
                          recordId={row?.record_id ?? null}
                          timeIn={row?.time_in ?? null}
                          timeOut={row?.time_out ?? null}
                          note={row?.note ?? null}
                        />
                      ) : (
                        canRequest &&
                        !pendingSet.has(iso) &&
                        iso <= todayISO && (
                          <RequestFixDialog
                            workDate={iso}
                            dateLabel={date.toLocaleDateString("en-PH", {
                              month: "long",
                              day: "numeric",
                              year: "numeric",
                            })}
                            timeIn={row?.time_in ?? null}
                            timeOut={row?.time_out ?? null}
                          />
                        )
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
