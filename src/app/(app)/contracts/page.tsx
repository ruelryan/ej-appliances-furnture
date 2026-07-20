import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { peso, fmtDateShort } from "@/lib/format";
import { TierBadge } from "@/components/tier-badge";
import { PaidProgress } from "@/components/paid-progress";
import { btnPrimary, btnSecondary, input } from "@/components/ui";

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
      "id, contract_no, display_name, item_description, contract_date, total_price, total_paid, remaining_balance, overdue_amount, followup_tier, payment_status, sales_agent, term_months"
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
        <h1 className="text-xl font-semibold text-ink">
          Contracts
        </h1>
        <Link href="/contracts/new" className={btnPrimary}>
          New contract
        </Link>
      </div>

      <form className="flex gap-2" action="/contracts" method="get">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search name, contract no., or item…"
          className={input}
        />
        <select
          name="status"
          defaultValue={status}
          className="rounded-card border border-line bg-white px-2 py-2.5 text-base"
        >
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="all">All</option>
        </select>
        <button type="submit" className={btnSecondary}>
          Search
        </button>
      </form>

      {error && (
        <p className="rounded-card bg-danger-bg px-3 py-2 text-sm text-danger">
          Could not load contracts: {error.message}
        </p>
      )}

      <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-white">
        {(contracts ?? []).map((c) => (
          <Link
            key={c.id}
            href={`/contracts/${c.id}`}
            className="block p-4 hover:bg-surface"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-display font-semibold text-ink">
                    {c.display_name}
                  </span>
                  {Number(c.term_months) === 0 && (
                    <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
                      CASH
                    </span>
                  )}
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
                <div className="mt-1 text-sm font-semibold text-ink">
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
