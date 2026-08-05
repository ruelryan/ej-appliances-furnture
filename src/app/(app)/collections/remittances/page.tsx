import Link from "next/link";
import { redirect } from "next/navigation";
import { canPostPayments, createClient, getProfile } from "@/lib/supabase/server";
import { peso, fmtDateShort, monthLabel, phTodayISO } from "@/lib/format";
import { SectionCard } from "@/components/section-card";
import { StatTile } from "@/components/stat-tile";
import { theadRow } from "@/components/ui";
import { RecordRemittanceForm } from "./record-remittance-form";
import { CancelRemittanceButton } from "./cancel-remittance-button";

export const dynamic = "force-dynamic";

interface Position {
  collector_id: string;
  collector_name: string | null;
  active: boolean;
  cash_collected: number | string;
  online_collected: number | string;
  total_collected: number | string;
  remitted_total: number | string;
  cash_on_hand: number | string;
  last_entry_on: string | null;
  last_remitted_on: string | null;
}

interface MonthRow {
  collector_id: string;
  collector_name: string | null;
  month: string;
  entries: number;
  collected_count: number;
  promised_count: number;
  cash_total: number | string;
  online_total: number | string;
  posted_total: number | string;
  cancelled_cash: number | string;
  cancelled_count: number;
}

// "2026-08" → the previous / next month, wrapping the year.
function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function RemittancesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const role = profile.role;
  const isCollector = role === "collector";
  const canPost = canPostPayments(role);
  if (!isCollector && !canPost) redirect("/");

  // Same predicate as the page gate. These were two different definitions of
  // the admin tier four lines apart — canPost included legacy staff, canRecord
  // did not — so a staff user reached the page and found the write controls
  // missing rather than refused. Both now mirror can_post_payments() in SQL.
  const canRecord = canPost;
  const isOwner = role === "owner";

  const { month } = await searchParams;
  const activeMonth = month ?? phTodayISO().slice(0, 7);

  const supabase = await createClient();

  // RLS scopes every one of these to the caller's own rows for a collector.
  const [{ data: positions }, { data: ledger }, { data: months }] =
    await Promise.all([
      supabase
        .from("v_collector_remittance")
        .select("*")
        .order("collector_name"),
      supabase
        .from("remittances")
        .select("*, collector:profiles!remittances_collector_id_fkey(full_name)")
        .order("remitted_on", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("v_collector_month")
        .select("*")
        .eq("month", `${activeMonth}-01`)
        .order("collector_name"),
    ]);

  const rows = (positions ?? []) as Position[];
  const monthRows = (months ?? []) as MonthRow[];

  const totalOnHand = rows.reduce((s, r) => s + Number(r.cash_on_hand), 0);
  const totalRemitted = rows.reduce((s, r) => s + Number(r.remitted_total), 0);
  const totalCollected = rows.reduce((s, r) => s + Number(r.total_collected), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">Remittances</h1>
        <div className="flex gap-2">
          <Link
            href="/collections/report"
            className="rounded-card border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-surface"
          >
            Daily report
          </Link>
          <Link
            href="/collections"
            className="rounded-card border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-surface"
          >
            Back
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile
          label={isCollector ? "Cash on hand" : "Cash with collectors"}
          value={peso(totalOnHand)}
          alert={totalOnHand > 0}
        />
        <StatTile label="Remitted to date" value={peso(totalRemitted)} />
        <StatTile label="Collected to date" value={peso(totalCollected)} />
      </div>

      {/* Running position per collector */}
      <SectionCard
        title="Balances"
        sub="Cash collected minus cash handed in. Online payments go straight to the office, so they never add to what a collector owes."
      >
        {rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">
            No collectors yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className={theadRow}>
                  <th className="py-1.5 pr-3">Collector</th>
                  <th className="py-1.5 pr-3">Cash collected</th>
                  <th className="py-1.5 pr-3">Online</th>
                  <th className="py-1.5 pr-3">Remitted</th>
                  <th className="py-1.5 pr-3">Cash on hand</th>
                  <th className="py-1.5 pr-3">Last remittance</th>
                  {canRecord && <th className="py-1.5" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const onHand = Number(r.cash_on_hand);
                  return (
                    <tr key={r.collector_id} className="border-b border-line">
                      <td className="py-1.5 pr-3 font-medium">
                        {r.collector_name ?? "—"}
                        {!r.active && (
                          <span className="ml-1 text-xs text-muted">
                            (inactive)
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3">{peso(r.cash_collected)}</td>
                      <td className="py-1.5 pr-3 text-muted">
                        {peso(r.online_collected)}
                      </td>
                      <td className="py-1.5 pr-3">{peso(r.remitted_total)}</td>
                      <td
                        className={`py-1.5 pr-3 font-semibold ${
                          onHand > 0 ? "text-danger" : "text-ink"
                        }`}
                      >
                        {peso(onHand)}
                      </td>
                      <td className="py-1.5 pr-3 text-muted">
                        {fmtDateShort(r.last_remitted_on)}
                      </td>
                      {canRecord && (
                        <td className="py-1.5">
                          <RecordRemittanceForm
                            collectorId={r.collector_id}
                            name={r.collector_name ?? "Collector"}
                            onHand={onHand}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* The ledger itself */}
      <SectionCard
        title="Remittance ledger"
        sub="Every hand-over of field cash to the office. Never deleted — a mistake is cancelled and re-recorded."
      >
        {(ledger ?? []).length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">
            No remittances recorded yet.
          </p>
        ) : (
          <div className="space-y-2">
            {(ledger ?? []).map((r) => {
              const cancelled = r.cancelled_at !== null;
              return (
                <div
                  key={r.id}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-card bg-surface px-3 py-2 ${
                    cancelled ? "opacity-60" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-ink">
                      {r.collector?.full_name ?? "—"} ·{" "}
                      <span className={cancelled ? "line-through" : ""}>
                        {peso(r.amount)}
                      </span>
                    </div>
                    <div className="truncate text-xs text-muted">
                      {r.remit_no} · {fmtDateShort(r.remitted_on)}
                      {r.note ? ` · ${r.note}` : ""}
                      {cancelled && (
                        <span className="text-danger">
                          {" "}
                          · cancelled
                          {r.cancel_reason ? `: ${r.cancel_reason}` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  {isOwner && !cancelled && (
                    <CancelRemittanceButton
                      remittanceId={r.id}
                      remitNo={r.remit_no}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* History */}
      <SectionCard
        title="Monthly history"
        sub="Collection activity by month."
        action={
          <div className="flex items-center gap-2 text-sm">
            <Link
              href={`/collections/remittances?month=${shiftMonth(activeMonth, -1)}`}
              className="rounded-card border border-line px-2 py-1 text-xs font-semibold text-ink hover:bg-surface"
            >
              Prev
            </Link>
            <span className="text-xs text-muted">
              {monthLabel(activeMonth)}
            </span>
            <Link
              href={`/collections/remittances?month=${shiftMonth(activeMonth, 1)}`}
              className="rounded-card border border-line px-2 py-1 text-xs font-semibold text-ink hover:bg-surface"
            >
              Next
            </Link>
          </div>
        }
      >
        {monthRows.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">
            No activity in {monthLabel(activeMonth)}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className={theadRow}>
                  <th className="py-1.5 pr-3">Collector</th>
                  <th className="py-1.5 pr-3">Visits</th>
                  <th className="py-1.5 pr-3">Collected</th>
                  <th className="py-1.5 pr-3">Promises</th>
                  <th className="py-1.5 pr-3">Cash</th>
                  <th className="py-1.5 pr-3">Online</th>
                  <th className="py-1.5">Cancelled</th>
                </tr>
              </thead>
              <tbody>
                {monthRows.map((m) => (
                  <tr key={m.collector_id} className="border-b border-line">
                    <td className="py-1.5 pr-3 font-medium">
                      {m.collector_name ?? "—"}
                    </td>
                    <td className="py-1.5 pr-3">{m.entries}</td>
                    <td className="py-1.5 pr-3">{m.collected_count}</td>
                    <td className="py-1.5 pr-3">{m.promised_count}</td>
                    <td className="py-1.5 pr-3">{peso(m.cash_total)}</td>
                    <td className="py-1.5 pr-3 text-muted">
                      {peso(m.online_total)}
                    </td>
                    <td
                      className={`py-1.5 ${
                        Number(m.cancelled_cash) > 0 ? "text-danger" : "text-muted"
                      }`}
                    >
                      {peso(m.cancelled_cash)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <p className="text-xs text-muted">
        Cash on hand is everything a collector took in cash, minus everything
        they have handed in. Posting a payment is an office bookkeeping step, so
        it does not reduce this — only a recorded remittance does. Online
        payments count towards a collector&apos;s collections but never towards
        what they owe, because that money goes straight to the office.
      </p>
    </div>
  );
}
