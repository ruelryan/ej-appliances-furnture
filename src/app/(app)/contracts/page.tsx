import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { peso, fmtDateShort } from "@/lib/format";
import { TierBadge } from "@/components/tier-badge";

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
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
          Contracts
        </h1>
        <Link
          href="/contracts/new"
          className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
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
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <select
          name="status"
          defaultValue={status}
          className="rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        >
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="all">All</option>
        </select>
        <button
          type="submit"
          className="rounded-lg bg-sky-800 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
        >
          Search
        </button>
      </form>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          Could not load contracts: {error.message}
        </p>
      )}

      <div className="space-y-2">
        {(contracts ?? []).map((c) => (
          <Link
            key={c.id}
            href={`/contracts/${c.id}`}
            className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-sky-400 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-600"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  {c.display_name}
                </div>
                <div className="truncate text-sm text-slate-500 dark:text-slate-400">
                  {c.item_description}
                </div>
                <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  #{c.contract_no} · {fmtDateShort(c.contract_date)}
                  {c.sales_agent ? ` · ${c.sales_agent}` : ""}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <TierBadge tier={c.followup_tier} />
                <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {peso(c.remaining_balance)}
                </div>
                <div className="text-[11px] text-slate-400">balance</div>
              </div>
            </div>
          </Link>
        ))}
        {contracts?.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">
            No contracts found{term ? ` for “${term}”` : ""}.
          </p>
        )}
      </div>
    </div>
  );
}
