import Link from "next/link";
import { createClient, getProfile } from "@/lib/supabase/server";
import { peso } from "@/lib/format";
import { StatTile } from "@/components/stat-tile";

export default async function DashboardPage() {
  const profile = await getProfile();
  const supabase = await createClient();

  const { data: stats } = await supabase
    .from("v_dashboard_stats")
    .select("*")
    .single();

  const tiles = [
    { label: "Open contracts", value: String(stats?.open_contracts ?? 0) },
    { label: "Outstanding balance", value: peso(stats?.outstanding_balance) },
    { label: "Overdue", value: peso(stats?.total_overdue), alert: Number(stats?.total_overdue) > 0 },
    { label: "Collected this month", value: peso(stats?.collected_this_month) },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-ink">
        Dashboard
      </h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <StatTile key={t.label} label={t.label} value={t.value} alert={t.alert} />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/payments/new"
          className="rounded-card bg-brand p-4 text-center font-semibold text-white shadow-cta hover:bg-brand-dark"
        >
          Record payment
        </Link>
        <Link
          href="/contracts/new"
          className="rounded-card border border-line bg-white p-4 text-center font-semibold text-ink hover:bg-surface"
        >
          New contract
        </Link>
        <Link
          href="/collections"
          className="rounded-card border border-line bg-white p-4 text-center font-semibold text-ink hover:bg-surface"
        >
          Collections worklist
          {(stats?.demand_tier_count ?? 0) + (stats?.overdue_tier_count ?? 0) > 0 && (
            <span className="ml-2 rounded-full bg-danger-bg px-2 py-0.5 text-xs font-semibold text-danger">
              {(stats?.demand_tier_count ?? 0) + (stats?.overdue_tier_count ?? 0)}
            </span>
          )}
        </Link>
        <Link
          href="/contracts"
          className="rounded-card border border-line bg-white p-4 text-center font-semibold text-ink hover:bg-surface"
        >
          Find a contract
        </Link>
      </div>

      {profile?.role === "owner" && (
        <div className="flex gap-3">
          <Link
            href="/analytics"
            className="text-sm font-medium text-brand hover:underline"
          >
            Analytics →
          </Link>
          <Link
            href="/admin"
            className="text-sm font-medium text-brand hover:underline"
          >
            Admin →
          </Link>
        </div>
      )}
    </div>
  );
}
