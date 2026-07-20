import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { peso, phTodayISO, fmtDateShort } from "@/lib/format";
import { SectionCard } from "@/components/section-card";
import { StatTile } from "@/components/stat-tile";

export const dynamic = "force-dynamic";

const DISPOSITION_LABELS: Record<string, string> = {
  collected: "Collected",
  promised: "Promised",
  not_available: "Not available",
  refused: "Refused",
};

export default async function CollectorReportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const role = profile.role;
  const isCollector = role === "collector";
  const canPost = role === "owner" || role === "admin" || role === "staff";
  if (!isCollector && !canPost) redirect("/");

  const { date } = await searchParams;
  const day = date ?? phTodayISO();

  const supabase = await createClient();

  // Per-collector roll-up for the day. RLS scopes a collector to their own row.
  const { data: rollup } = await supabase
    .from("v_collector_day")
    .select("*")
    .eq("work_date", day);

  // Detailed entries for the day (RLS scopes collectors to their own).
  const { data: entries } = await supabase
    .from("collection_entries")
    .select(
      "*, contract:contracts(contract_no, customer:customers(display_name))"
    )
    .eq("work_date", day)
    .order("collector_id")
    .order("created_at", { ascending: false });

  const rows = rollup ?? [];
  const totalCash = rows.reduce((s, r) => s + Number(r.cash_total), 0);
  const totalOnline = rows.reduce((s, r) => s + Number(r.online_total), 0);
  const totalPosted = rows.reduce((s, r) => s + Number(r.posted_total), 0);
  const totalPending = rows.reduce((s, r) => s + Number(r.pending_total), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">
          Daily report — {fmtDateShort(day)}
        </h1>
        <Link
          href="/collections"
          className="rounded-card border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-surface"
        >
          Back
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Cash collected" value={peso(totalCash)} />
        <StatTile label="Online collected" value={peso(totalOnline)} />
        <StatTile label="Posted" value={peso(totalPosted)} />
        <StatTile
          label="Pending to post"
          value={peso(totalPending)}
          alert={totalPending > 0}
        />
      </div>

      {/* Remittance reconcile */}
      <SectionCard
        title="Remittance"
        sub="Cash collected must equal cash turned in. Online entries carry a reference; the admin posts each collected entry as a payment."
      >
        {rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">
            No activity recorded for this day.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-1.5 pr-3">Collector</th>
                  <th className="py-1.5 pr-3">Visited</th>
                  <th className="py-1.5 pr-3">Collected</th>
                  <th className="py-1.5 pr-3">Cash</th>
                  <th className="py-1.5 pr-3">Online</th>
                  <th className="py-1.5">Posted</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.collector_id} className="border-b border-line">
                    <td className="py-1.5 pr-3 font-medium">
                      {r.collector_name}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">{r.entries}</td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {r.collected_count}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {peso(r.cash_total)}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {peso(r.online_total)}
                    </td>
                    <td className="py-1.5 tabular-nums">
                      {peso(r.posted_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Detailed log */}
      <SectionCard title="Entries" sub="Every visit outcome logged this day.">
        {(entries ?? []).length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">
            No entries logged.
          </p>
        ) : (
          <div className="space-y-2">
            {(entries ?? []).map((e) => (
              <div
                key={e.id}
                className={`flex items-center justify-between gap-2 rounded-card px-3 py-2 ${
                  e.status === "cancelled" ? "bg-surface opacity-60" : "bg-surface"
                }`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">
                    {e.contract?.customer?.display_name ?? "—"}
                    {e.disposition === "collected" ? ` · ${peso(e.amount)}` : ""}
                  </div>
                  <div className="truncate text-xs text-muted">
                    #{e.contract?.contract_no} ·{" "}
                    {DISPOSITION_LABELS[e.disposition] ?? e.disposition}
                    {e.method ? ` · ${e.method}` : ""}
                    {e.reference_no ? ` · ${e.reference_no}` : ""} ·{" "}
                    <span
                      className={
                        e.status === "posted"
                          ? "text-positive"
                          : e.status === "cancelled"
                            ? "text-danger"
                            : "text-muted"
                      }
                    >
                      {e.status}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
