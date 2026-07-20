import { redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { peso } from "@/lib/format";
import { StatTile } from "@/components/stat-tile";
import { SectionCard } from "@/components/section-card";
import { theadRow } from "@/components/ui";
import {
  MonthlyBars,
  CollectionsVsExpected,
  AgentBars,
  AgingChart,
  CashflowLine,
} from "./charts";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const profile = await getProfile();
  if (profile?.role !== "owner") redirect("/");

  const supabase = await createClient();

  const [
    { data: stats },
    { data: salesMonthly },
    { data: cve },
    { data: byAgent },
    { data: byType },
    { data: aging },
    { data: cashflow },
    { data: topCustomers },
  ] = await Promise.all([
    supabase.from("v_dashboard_stats").select("*").single(),
    supabase.from("v_sales_monthly").select("*"),
    supabase.from("v_collections_vs_expected").select("*"),
    supabase.from("v_sales_by_agent").select("*").limit(10),
    supabase.from("v_sales_by_item_type").select("*").limit(10),
    supabase.from("v_aging").select("*"),
    supabase.from("v_cashflow_monthly").select("*"),
    supabase.from("v_top_customers").select("*").limit(15),
  ]);

  // last 12 months only for time-series charts
  const last12 = <T extends { month: string }>(rows: T[] | null) =>
    (rows ?? []).slice(-12);

  const tiles = [
    { label: "Open contracts", value: String(stats?.open_contracts ?? 0) },
    { label: "Outstanding balance", value: peso(stats?.outstanding_balance) },
    { label: "Total overdue", value: peso(stats?.total_overdue) },
    { label: "Collected this month", value: peso(stats?.collected_this_month) },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-ink">
        Analytics
      </h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <StatTile key={t.label} label={t.label} value={t.value} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Sales by month" sub="New contract value (₱)">
          <MonthlyBars data={last12(salesMonthly)} />
        </ChartCard>

        <ChartCard
          title="Collections vs expected"
          sub="Actual payments received vs scheduled amortizations"
        >
          <CollectionsVsExpected data={last12(cve)} />
        </ChartCard>

        <ChartCard title="Cash flow" sub="Payments collected per month (₱)">
          <CashflowLine data={last12(cashflow)} />
        </ChartCard>

        <ChartCard
          title="Aging receivables"
          sub="Open contracts by months behind"
        >
          <AgingChart data={aging ?? []} />
        </ChartCard>

        <ChartCard title="Sales by agent" sub="Total contract value (₱)">
          <AgentBars
            data={(byAgent ?? []).map((r) => ({
              name: r.sales_agent,
              value: Number(r.contract_value_total),
              count: Number(r.contract_count),
            }))}
          />
        </ChartCard>

        <ChartCard title="Sales by item type" sub="Total contract value (₱)">
          <AgentBars
            data={(byType ?? []).map((r) => ({
              name: r.item_type,
              value: Number(r.contract_value_total),
              count: Number(r.contract_count),
            }))}
          />
        </ChartCard>
      </div>

      <SectionCard title="Top customers" sub="By lifetime contract value">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={theadRow}>
                <th className="py-1.5 pr-3">Customer</th>
                <th className="py-1.5 pr-3 text-right">Contracts</th>
                <th className="py-1.5 pr-3 text-right">Lifetime value</th>
                <th className="py-1.5 text-right">Current balance</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {(topCustomers ?? []).map((c) => (
                <tr
                  key={c.customer_id}
                  className="border-b border-line"
                >
                  <td className="py-1.5 pr-3">{c.display_name}</td>
                  <td className="py-1.5 pr-3 text-right">{c.contract_count}</td>
                  <td className="py-1.5 pr-3 text-right">{peso(c.lifetime_value)}</td>
                  <td className="py-1.5 text-right">{peso(c.current_balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

const ChartCard = SectionCard;
