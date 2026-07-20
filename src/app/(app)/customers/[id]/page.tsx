import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient, getProfile, canPostPayments } from "@/lib/supabase/server";
import { peso, fmtDateShort } from "@/lib/format";
import { TierBadge } from "@/components/tier-badge";
import { BackLink } from "@/components/back-link";
import { formatAddress } from "@/lib/maps";
import { getLocationTree } from "@/lib/locations";
import { EditLinksForm } from "./edit-links-form";
import { EditAddressForm } from "./edit-address-form";

export const dynamic = "force-dynamic";

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await getProfile();
  const mayEdit = profile ? canPostPayments(profile.role) : false;
  const locationTree = mayEdit ? await getLocationTree() : {};

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
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
          <BackLink /> {customer.display_name}
        </h1>
        <div className="mt-1 space-y-0.5 text-sm text-muted">
          <div>{(customer.phones ?? []).join(" / ") || "No phone on file"}</div>
          {/* Prefer the structured address; customers.address is kept as the
              address-as-given and is only the fallback. */}
          <div>{formatAddress(customer) || "No address on file"}</div>
          {customer.landmark && (
            <div className="text-xs">Landmark: {customer.landmark}</div>
          )}
          <div className="flex flex-wrap gap-4 pt-1">
            {customer.messenger_url && (
              <a
                href={customer.messenger_url}
                target="_blank"
                className="font-medium text-brand hover:underline"
              >
                Personal Messenger
              </a>
            )}
            {customer.collection_gc_url && (
              <a
                href={customer.collection_gc_url}
                target="_blank"
                className="font-medium text-brand hover:underline"
              >
                Collection group chat
              </a>
            )}
            {customer.gps_url && (
              <a
                href={customer.gps_url}
                target="_blank"
                className="font-medium text-brand hover:underline"
              >
                Map
              </a>
            )}
          </div>
        </div>
        {mayEdit && (
          <div className="mt-3">
            <div className="flex flex-wrap gap-2">
              <EditAddressForm
                customerId={customer.id}
                tree={locationTree}
                current={{
                  province: customer.province,
                  municipality: customer.municipality,
                  barangay: customer.barangay,
                  street_purok: customer.street_purok,
                  landmark: customer.landmark,
                }}
              />
              <EditLinksForm
                customerId={customer.id}
                messengerUrl={customer.messenger_url}
                collectionGcUrl={customer.collection_gc_url}
              />
            </div>
          </div>
        )}
      </div>

      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
          Contracts ({contracts?.length ?? 0})
        </h2>
        <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-white">
          {(contracts ?? []).map((c) => (
            <Link
              key={c.id}
              href={`/contracts/${c.id}`}
              className="flex items-start justify-between gap-2 p-4 hover:bg-surface"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink">
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
