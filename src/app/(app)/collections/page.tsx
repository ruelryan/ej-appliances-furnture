import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { peso, fmtDateShort } from "@/lib/format";
import { buildFollowupMessage, type ContractFinancials } from "@/lib/messages";
import { TierBadge } from "@/components/tier-badge";
import { CopyButton } from "@/components/copy-button";

export const dynamic = "force-dynamic";

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string }>;
}) {
  const { tier = "all" } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("v_contract_financials")
    .select("*")
    .eq("payment_status", "open")
    .in("followup_tier", ["overdue", "demand"])
    .order("overdue_amount", { ascending: false });

  if (tier === "demand" || tier === "overdue") {
    query = query.eq("followup_tier", tier);
  }

  const { data: contracts } = await query;

  const tabs = [
    { key: "all", label: "All" },
    { key: "demand", label: "Demand (3+ mo)" },
    { key: "overdue", label: "Overdue" },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
        Collections Worklist
      </h1>

      <div className="flex gap-2">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/collections?tier=${t.key}`}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              tier === t.key
                ? "bg-sky-800 text-white"
                : "border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <div className="space-y-3">
        {(contracts ?? []).map((c) => {
          const message = buildFollowupMessage(c as ContractFinancials);
          return (
            <div
              key={c.id}
              className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/contracts/${c.id}`}
                    className="font-semibold text-slate-900 hover:underline dark:text-slate-100"
                  >
                    {c.display_name}
                  </Link>
                  <div className="truncate text-xs text-slate-500">
                    #{c.contract_no} · {c.item_description}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    Last payment:{" "}
                    {c.last_payment_date ? fmtDateShort(c.last_payment_date) : "never"}
                    {c.collection_status ? ` · ${c.collection_status}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <TierBadge tier={c.followup_tier} />
                  <div className="mt-1 text-sm font-bold text-red-600 dark:text-red-400">
                    {peso(c.overdue_amount)}
                  </div>
                  <div className="text-[11px] text-slate-400">past due</div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <CopyButton text={message} label="📋 Copy message" />
                {c.messenger_url && (
                  <a
                    href={c.messenger_url}
                    target="_blank"
                    className="rounded-lg bg-[#0084ff] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                  >
                    💬 Messenger
                  </a>
                )}
                {c.gps_url && (
                  <a
                    href={c.gps_url}
                    target="_blank"
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    📍 Map
                  </a>
                )}
                {c.followup_tier === "demand" && (
                  <Link
                    href={`/print/demand-letter/${c.id}`}
                    className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600"
                  >
                    📄 Demand letter
                  </Link>
                )}
              </div>
            </div>
          );
        })}
        {contracts?.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">
            🎉 No overdue accounts in this view.
          </p>
        )}
      </div>
    </div>
  );
}
