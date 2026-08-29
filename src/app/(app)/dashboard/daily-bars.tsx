import { peso } from "@/lib/format";

/**
 * Cash collected per day, drawn as plain divs.
 *
 * Deliberately NOT Recharts, even though it is already a dependency. This is
 * the first screen after login, the staff are on rural mobile data, and the
 * Recharts client bundle is around 100KB for a chart with no interaction
 * requirement. Bars with a `title` are a server component: zero JavaScript
 * ships. Recharts stays on /analytics, which is owner-only and read at a desk.
 *
 * Bars rather than a line, per the dataviz form heuristic: daily takings are
 * spiky and genuinely ₱0 on days nobody paid. A line would draw a slope across
 * a closed Sunday and invent money that never arrived. A bar of height zero is
 * the honest mark.
 *
 * v_cashflow_daily has NO ROW for a day with no payments, so the axis is
 * filled here. That is calendar arithmetic — building the list of dates to
 * show — and not a recomputation of any business figure: every peso amount
 * still comes from SQL exactly as the view returned it.
 */
export function DailyBars({
  rows,
  days = 30,
  today,
}: {
  rows: { day: string; collected: number | string }[];
  days?: number;
  /** Asia/Manila 'YYYY-MM-DD', from phTodayISO() — never `new Date()` here. */
  today: string;
}) {
  const byDay = new Map(rows.map((r) => [r.day, Number(r.collected)]));

  // Walk back from today in UTC to avoid a local-timezone shift changing which
  // calendar day a bar represents.
  const end = new Date(today + "T00:00:00Z");
  const series: { day: string; value: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    series.push({ day: key, value: byDay.get(key) ?? 0 });
  }

  const max = Math.max(...series.map((s) => s.value), 1);
  const paidDays = series.filter((s) => s.value > 0);
  const total = series.reduce((a, s) => a + s.value, 0);
  const best = series.reduce((a, s) => (s.value > a.value ? s : a), series[0]);

  const label = (iso: string) =>
    new Date(iso + "T00:00:00Z").toLocaleDateString("en-PH", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
    });

  if (!paidDays.length) {
    return (
      <p className="py-6 text-center text-sm text-muted">
        No payments recorded in the last {days} days.
      </p>
    );
  }

  return (
    <div>
      <div className="flex h-28 items-end gap-[3px] sm:h-36">
        {series.map((s) => (
          <div
            key={s.day}
            className="group flex h-full flex-1 items-end"
            title={`${label(s.day)} — ${s.value ? peso(s.value) : "no payments"}`}
          >
            <div
              className={`w-full rounded-t-[3px] ${
                s.value ? "bg-chart-1 group-hover:bg-brand" : "bg-surface"
              }`}
              // A zero day still draws a 2px stub, so the gap reads as "we were
              // open and nothing came in" rather than as missing data.
              style={{ height: s.value ? `${Math.max((s.value / max) * 100, 4)}%` : "2px" }}
            />
          </div>
        ))}
      </div>

      <div className="mt-1.5 flex justify-between text-micro text-muted">
        <span>{label(series[0].day)}</span>
        <span>{label(series[series.length - 1].day)}</span>
      </div>

      <p className="mt-2 text-xs text-muted">
        <span className="font-semibold text-ink tabular-nums">{peso(total)}</span> over{" "}
        {days} days · money arrived on {paidDays.length} of them · best day{" "}
        <span className="tabular-nums">{peso(best.value)}</span> on {label(best.day)}
      </p>
    </div>
  );
}
