import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { peso, fmtDateShort } from "@/lib/format";
import { SectionCard } from "@/components/section-card";
import { StatTile } from "@/components/stat-tile";
import { MarkPaidButton } from "./mark-paid-button";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  pending: "border border-line bg-white text-muted",
  earned: "bg-warning-bg text-warning",
  paid: "bg-positive/10 text-positive",
  voided: "bg-danger-bg text-danger",
};

const TABS = [
  { key: "all", label: "All" },
  { key: "earned", label: "Payable" },
  { key: "pending", label: "Pending" },
  { key: "paid", label: "Paid" },
  { key: "voided", label: "Voided" },
];

export default async function CommissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  const role = profile.role;
  const canManage = role === "owner" || role === "admin" || role === "staff";
  const isAgent = role === "sales_agent";
  if (!canManage && !isAgent) redirect("/");

  const { status = "all" } = await searchParams;

  const supabase = await createClient();
  // RLS scopes agents to their own commissions automatically.
  const { data: rows } = await supabase
    .from("v_commissions")
    .select("*")
    .order("created_at", { ascending: false });

  const all = rows ?? [];
  const sum = (s: string) =>
    all
      .filter((r) => r.status === s)
      .reduce((a, r) => a + Number(r.commission_amount), 0);

  const shown =
    status === "all" ? all : all.filter((r) => r.status === status);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">
          {isAgent ? "My commissions" : "Commissions"}
        </h1>
        {isAgent && (
          <Link
            href={`/print/commission-statement/${profile.id}`}
            className="rounded-card border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-surface"
          >
            Print statement
          </Link>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Payable (earned)" value={peso(sum("earned"))} alert={sum("earned") > 0} />
        <StatTile label="Pending" value={peso(sum("pending"))} />
        <StatTile label="Paid out" value={peso(sum("paid"))} />
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/commissions?status=${t.key}`}
            className={`rounded-full px-3.5 py-2 text-xs font-semibold ${
              status === t.key
                ? "bg-brand text-white"
                : "border border-line bg-white text-ink hover:bg-surface"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <SectionCard title={isAgent ? "Deals" : "All commissions"}>
        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            No commissions in this view.
          </p>
        ) : (
          <div className="space-y-2">
            {shown.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-surface px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/contracts/${r.contract_id}`}
                      className="text-sm font-semibold text-ink hover:underline"
                    >
                      {r.customer_name}
                    </Link>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        STATUS_STYLE[r.status]
                      }`}
                    >
                      {r.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="truncate text-xs text-muted">
                    #{r.contract_no} · {peso(r.commission_amount)}
                    {!isAgent && r.agent_name ? ` · ${r.agent_name}` : ""}
                    {r.status === "earned" && r.dp_paid_date
                      ? ` · DP paid ${fmtDateShort(r.dp_paid_date)}`
                      : ""}
                    {r.status === "paid" && r.paid_at
                      ? ` · paid ${fmtDateShort(r.paid_at)}`
                      : ""}
                  </div>
                </div>
                {canManage && r.status === "earned" && (
                  <MarkPaidButton commissionId={r.id} />
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
