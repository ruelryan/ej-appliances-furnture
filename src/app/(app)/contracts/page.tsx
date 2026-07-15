import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { peso, fmtDateShort } from "@/lib/format";
import { TierBadge } from "@/components/tier-badge";
import { PaidProgress } from "@/components/paid-progress";

export const dynamic = "force-dynamic";

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { q = "", status = "open" } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("v_contract_financials")
    .select(
      "id, contract_no, display_name, item_description, contract_date, total_price, total_paid, remaining_balance, overdue_amount, followup_tier, payment_status, sales_agent"
    )
    .order("contract_date", { ascending: false })
    .limit(100);

  if (status === "open" || status === "closed") {
    query = query.eq("payment_status", status);
  }

  const term = q.trim();
  if (term) {
    query = query.or(
      `contract_no.ilike.%${term}%,display_name.ilike.%${term}%,item_description.ilike.%${term}%`
    );
  }

  const { data: contracts, error } = await query;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-navy">
          Contracts
        </h1>
        <Link
          href="/contracts/new"
          className="rounded-card bg-teal px-3 py-2 text-sm font-semibold text-white hover:bg-teal-dark"
        >
          + New
        </Link>
      </div>

      <form className="flex gap-2" action="/contracts" method="get">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search name, contract no., or item…"
          className="w-full rounded-card border border-surface px-3 py-2.5 text-base"
        />
        <select
          name="status"
          defaultValue={status}
          className="rounded-card border border-surface px-2 py-2.5 text-base"
        >
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="all">All</option>
        </select>
        <button
          type="submit"
          className="rounded-card bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          Search
        </button>
      </form>

      {error && (
        <p className="rounded-card bg-danger-bg px-3 py-2 text-sm text-danger">
          Could not load contracts: {error.message}
        </p>
      )}

      <div className="space-y-2">
        {(contracts ?? []).map((c) => (
          <Link
            key={c.id}
            href={`/contracts/${c.id}`}
            className="block rounded-card border border-surface bg-white p-4 hover:border-brand"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-display font-semibold text-navy">
                  {c.display_name}
                </div>
                <div className="truncate text-sm text-muted">
                  {c.item_description}
                </div>
                <div className="mt-1 text-xs text-muted">
                  #{c.contract_no} · {fmtDateShort(c.contract_date)}
                  {c.sales_agent ? ` · ${c.sales_agent}` : ""}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <TierBadge tier={c.followup_tier} />
                <div className="mt-1 text-sm font-semibold text-navy">
                  {peso(c.remaining_balance)}
                </div>
                <div className="text-[11px] text-muted">balance</div>
              </div>
            </div>
            {c.payment_status === "open" && (
              <PaidProgress
                paid={Number(c.total_paid)}
                total={Number(c.total_price)}
                className="mt-2"
              />
            )}
          </Link>
        ))}
        {contracts?.length === 0 && (
          <p className="py-8 text-center text-sm text-muted">
            No contracts found{term ? ` for “${term}”` : ""}.
          </p>
        )}
      </div>
    </div>
  );
}
