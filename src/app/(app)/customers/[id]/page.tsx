import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { peso, fmtDateShort } from "@/lib/format";
import { TierBadge } from "@/components/tier-badge";

export const dynamic = "force-dynamic";

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: customer } = await supabase
    .from("customers")
    .select("*")
    .eq("id", id)
    .single();

  if (!customer) notFound();

  const { data: contracts } = await supabase
    .from("v_contract_financials")
    .select(
      "id, contract_no, item_description, contract_date, total_price, total_paid, remaining_balance, followup_tier, payment_status"
    )
    .eq("customer_id", id)
    .order("contract_date", { ascending: false });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-navy">
          {customer.display_name}
        </h1>
        <div className="mt-1 space-y-0.5 text-sm text-muted">
          <div>📞 {(customer.phones ?? []).join(" / ") || "no phone"}</div>
          {customer.address && <div>🏠 {customer.address}</div>}
          <div className="flex gap-3 pt-1">
            {customer.messenger_url && (
              <a
                href={customer.messenger_url}
                target="_blank"
                className="font-medium text-brand hover:underline"
              >
                💬 Messenger
              </a>
            )}
            {customer.gps_url && (
              <a
                href={customer.gps_url}
                target="_blank"
                className="font-medium text-brand hover:underline"
              >
                📍 Map
              </a>
            )}
          </div>
        </div>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-bold text-navy">
          Contracts ({contracts?.length ?? 0})
        </h2>
        <div className="space-y-2">
          {(contracts ?? []).map((c) => (
            <Link
              key={c.id}
              href={`/contracts/${c.id}`}
              className="flex items-start justify-between gap-2 rounded-card border border-surface bg-white p-4 hover:border-brand"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-navy">
                  {c.item_description}
                </div>
                <div className="text-xs text-muted">
                  #{c.contract_no} · {fmtDateShort(c.contract_date)}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <TierBadge tier={c.followup_tier} />
                <div className="mt-1 text-sm font-semibold">
                  {peso(c.remaining_balance)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
