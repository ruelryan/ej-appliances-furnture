import Link from "next/link";
import { createClient, getProfile } from "@/lib/supabase/server";
import { peso } from "@/lib/format";

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
      <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
        Dashboard
      </h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {t.label}
            </div>
            <div
              className={`mt-1 text-lg font-bold ${
                t.alert
                  ? "text-red-600 dark:text-red-400"
                  : "text-slate-900 dark:text-slate-100"
              }`}
            >
              {t.value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/payments/new"
          className="rounded-xl bg-sky-800 p-4 text-center font-semibold text-white hover:bg-sky-700"
        >
          💵 Record Payment
        </Link>
        <Link
          href="/contracts/new"
          className="rounded-xl bg-emerald-700 p-4 text-center font-semibold text-white hover:bg-emerald-600"
        >
          📄 New Contract
        </Link>
        <Link
          href="/collections"
          className="rounded-xl border border-slate-300 bg-white p-4 text-center font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          📢 Collections worklist
          {(stats?.demand_tier_count ?? 0) + (stats?.overdue_tier_count ?? 0) > 0 && (
            <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700 dark:bg-red-900 dark:text-red-200">
              {(stats?.demand_tier_count ?? 0) + (stats?.overdue_tier_count ?? 0)}
            </span>
          )}
        </Link>
        <Link
          href="/contracts"
          className="rounded-xl border border-slate-300 bg-white p-4 text-center font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          🔍 Find a contract
        </Link>
      </div>

      {profile?.role === "owner" && (
        <div className="flex gap-3">
          <Link
            href="/analytics"
            className="text-sm font-medium text-sky-700 hover:underline dark:text-sky-300"
          >
            📊 Analytics →
          </Link>
          <Link
            href="/admin"
            className="text-sm font-medium text-sky-700 hover:underline dark:text-sky-300"
          >
            ⚙️ Admin →
          </Link>
        </div>
      )}
    </div>
  );
}
