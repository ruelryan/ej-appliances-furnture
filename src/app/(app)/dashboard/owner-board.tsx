import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { peso, phTodayISO, fmtDateShort } from "@/lib/format";
import { StatTile } from "@/components/stat-tile";
import { SectionCard } from "@/components/section-card";
import { Alert } from "@/components/alert";
import { btnPrimary, btnSecondary } from "@/components/ui";
import { DailyBars } from "./daily-bars";

/**
 * The owner's board: money, and what needs deciding today.
 *
 * The rule that shapes every block — the dashboard answers "what changed and
 * what needs me", /analytics answers "how are we doing over time". The old
 * dashboard's four tiles were byte-identical to the top of /analytics, which
 * is why it felt like a launcher rather than a place to think.
 *
 * Every figure here leads somewhere. Noticing a problem and starting on it
 * should be one gesture.
 */

const dayStart = (today: string, back: number) => {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
};

export async function OwnerBoard() {
  const supabase = await createClient();
  const today = phTodayISO();
  const month = today.slice(0, 7);

  const [
    stats,
    expected,
    remit,
    daily,
    collectorsToday,
    onlineToday,
    neverPaid,
    promises,
    unposted,
    doublePost,
    deliveries,
    salesMonth,
  ] = await Promise.all([
    supabase.from("v_dashboard_stats").select("*").single(),
    supabase.from("v_collections_vs_expected").select("month, expected, collected").eq("month", `${month}-01`).maybeSingle(),
    supabase.from("v_collector_remittance").select("collector_name, cash_on_hand, last_remitted_on"),
    supabase.from("v_cashflow_daily").select("day, collected").gte("day", dayStart(today, 29)).order("day"),
    supabase.from("v_collector_day").select("collector_name, entries, collected_count, cash_total, online_total").eq("work_date", today),
    // Most of the collecting is done from the office over Messenger and GCash,
    // not on a route. v_collector_day only knows about logged field visits, so
    // on its own this section reported nothing on days when thousands came in.
    supabase.from("v_online_collections_day").select("recorded_by_name, payments, online_total").eq("work_date", today),
    supabase.from("v_contract_financials").select("id", { count: "exact", head: true }).eq("payment_status", "open").eq("payment_count", 0),
    supabase.from("v_open_promises").select("contract_id", { count: "exact", head: true }),
    supabase.from("collection_entries").select("amount").eq("status", "pending").eq("disposition", "collected"),
    supabase.from("v_entry_payment_candidates").select("entry_id", { count: "exact", head: true }),
    supabase.from("v_deliveries").select("status, days_awaiting_invoice").in("status", ["pending", "to_order", "ordered"]),
    supabase.from("v_sales_monthly").select("month, contract_count, contract_value_total").eq("month", `${month}-01`).maybeSingle(),
  ]);

  // The old dashboard destructured `{ data }` and dropped `error`, so a failed
  // query rendered peso(undefined) — a confident ₱0.00 that reads as a business
  // fact. Say "unavailable" instead; a blank is honest, a zero is a lie.
  const failed = stats.error;

  const s = stats.data;
  const onHand = (remit.data ?? []).reduce((a, r) => a + Number(r.cash_on_hand ?? 0), 0);
  const holders = (remit.data ?? []).filter((r) => Number(r.cash_on_hand ?? 0) > 0);
  const oldestRemit = holders
    .map((h) => h.last_remitted_on)
    .filter(Boolean)
    .sort()[0];

  const expectedMtd = Number(expected.data?.expected ?? 0);
  const collectedMtd = Number(s?.collected_this_month ?? 0);
  const efficiency = expectedMtd > 0 ? Math.round((collectedMtd / expectedMtd) * 100) : null;

  const unpostedTotal = (unposted.data ?? []).reduce((a, e) => a + Number(e.amount ?? 0), 0);
  const staleInvoice = (deliveries.data ?? []).filter((d) => Number(d.days_awaiting_invoice ?? 0) > 3).length;
  const toArrange = (deliveries.data ?? []).filter((d) => d.status !== "ordered").length;

  const tiles = [
    {
      label: "Collected this month",
      value: failed ? "—" : peso(collectedMtd),
      sub: efficiency !== null ? `${efficiency}% of ${peso(expectedMtd)} due` : undefined,
      tone: efficiency !== null && efficiency < 70 ? ("alert" as const) : ("default" as const),
      href: "/payments",
    },
    {
      // The number with the most money at risk and the least visibility: cash
      // a collector has taken but not yet handed over. It has been available
      // since 0030 and appeared on no dashboard.
      label: "Cash still in the field",
      value: failed ? "—" : peso(onHand),
      sub: onHand > 0
        ? `${holders.length} collector${holders.length === 1 ? "" : "s"}${oldestRemit ? ` · last handover ${fmtDateShort(oldestRemit)}` : ""}`
        : "All handed in",
      tone: onHand > 0 ? ("alert" as const) : ("positive" as const),
      href: "/collections/remittances",
    },
    {
      label: "Past due",
      value: failed ? "—" : peso(s?.total_overdue),
      sub: `${s?.demand_tier_count ?? 0} demand · ${s?.overdue_tier_count ?? 0} overdue`,
      tone: Number(s?.total_overdue ?? 0) > 0 ? ("alert" as const) : ("default" as const),
      href: "/collections",
    },
    {
      label: "Sold this month",
      value: failed ? "—" : peso(salesMonth.data?.contract_value_total ?? 0),
      sub: `${salesMonth.data?.contract_count ?? 0} new contracts`,
      href: "/contracts",
    },
  ];

  const queue = [
    {
      label: "Never paid a peso",
      count: neverPaid.count ?? 0,
      hint: "Open contracts with no payment at all. These can never reach the demand tier on their own — it keys on the last payment date, and there isn't one.",
      href: "/contracts?filter=neverpaid",
      tone: "alert" as const,
    },
    {
      label: "Promises now due",
      count: promises.count ?? 0,
      hint: "The customer named a date and it has arrived or passed.",
      href: "/collections",
      tone: "default" as const,
    },
    {
      label: "Collected but not posted",
      count: (unposted.data ?? []).length,
      hint: `${peso(unpostedTotal)} logged in the field that is not a payment yet.`,
      href: "/collections",
      tone: "default" as const,
    },
    {
      label: "Possible double posting",
      count: doublePost.count ?? 0,
      hint: "A logged collection that exactly matches a payment already recorded. Link them instead of posting twice.",
      href: "/collections",
      tone: (doublePost.count ?? 0) > 0 ? ("alert" as const) : ("default" as const),
    },
  ].filter((q) => q.count > 0);

  return (
    <div className="space-y-5">
      {failed && (
        <Alert tone="danger" title="Some figures could not be loaded">
          The database did not answer. The tiles below show a dash rather than a
          zero — do not read them as ₱0.00. Reload in a moment.
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <StatTile key={t.label} {...t} />
        ))}
      </div>

      <SectionCard
        title="Cash collected — last 30 days"
        sub="Every payment recorded, by the day it was received."
      >
        <DailyBars rows={daily.data ?? []} days={30} today={today} />
      </SectionCard>

      {queue.length > 0 && (
        <SectionCard
          title="Needs a decision"
          sub="Ordered by how much is at stake. Each one opens the list behind it."
        >
          <div className="divide-y divide-line">
            {queue.map((q) => (
              <Link key={q.label} href={q.href} className="-mx-2 flex items-start gap-3 px-2 py-2.5 hover:bg-surface">
                <span
                  className={`mt-0.5 min-w-8 shrink-0 rounded-full px-2 py-0.5 text-center text-xs font-semibold tabular-nums ${
                    q.tone === "alert" ? "bg-danger-bg text-danger" : "bg-surface text-ink"
                  }`}
                >
                  {q.count}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{q.label}</span>
                  <span className="block text-xs text-muted">{q.hint}</span>
                </span>
              </Link>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Collection happens two ways here and this used to show only one of
          them. Field visits come from collection_entries; most of the money
          actually arrives over Messenger and GCash and is recorded straight as
          a payment, which v_collector_day cannot see. Showing only visits
          reported "nothing collected today" on days worth tens of thousands. */}
      <SectionCard title="Collected today" sub={fmtDateShort(today)}>
        {(collectorsToday.data ?? []).length === 0 &&
        (onlineToday.data ?? []).length === 0 ? (
          <p className="py-3 text-sm text-muted">Nothing collected yet today.</p>
        ) : (
          <div className="space-y-1.5">
            {(onlineToday.data ?? []).map((o) => (
              <div key={`on-${o.recorded_by_name}`} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-ink">
                  {o.recorded_by_name ?? "—"}
                  <span className="ml-1.5 rounded-full bg-brand/10 px-1.5 py-0.5 text-micro font-semibold text-brand">
                    online
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted">
                  {o.payments} payment{Number(o.payments) === 1 ? "" : "s"} ·{" "}
                  <span className="tabular-nums text-ink">{peso(o.online_total)}</span>
                </span>
              </div>
            ))}
            {(collectorsToday.data ?? []).map((c) => (
              <div key={c.collector_name} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-ink">
                  {c.collector_name}
                  <span className="ml-1.5 rounded-full bg-surface px-1.5 py-0.5 text-micro font-semibold text-muted">
                    field
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted">
                  {c.entries} visit{c.entries === 1 ? "" : "s"} · {c.collected_count} paid ·{" "}
                  <span className="tabular-nums text-ink">
                    {peso(Number(c.cash_total ?? 0) + Number(c.online_total ?? 0))}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
        {(toArrange > 0 || staleInvoice > 0) && (
          <div className="mt-3 border-t border-line pt-3 text-xs text-muted">
            <Link href="/deliveries" className="hover:underline">
              {toArrange} deliver{toArrange === 1 ? "y" : "ies"} still to arrange
              {staleInvoice > 0 && ` · ${staleInvoice} waiting over 3 days for a supplier invoice`}
            </Link>
          </div>
        )}
      </SectionCard>

      <div className="flex flex-wrap gap-2">
        <Link href="/payments/new" className={btnPrimary}>
          Record payment
        </Link>
        <Link href="/contracts/new" className={btnSecondary}>
          New contract
        </Link>
        <Link href="/analytics" className={btnSecondary}>
          Analytics
        </Link>
      </div>
    </div>
  );
}
