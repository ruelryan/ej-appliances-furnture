import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { peso, fmtDateShort } from "@/lib/format";
import { formatAddress, directionsUrl, hasExactPin } from "@/lib/maps";
import { SectionCard } from "@/components/section-card";
import { StatTile } from "@/components/stat-tile";
import { DeliveryControls } from "./delivery-controls";
import { AddSupplierForm } from "./add-supplier-form";
import { DELIVERY_STATUS_LABEL } from "../contracts/[id]/delivery-panel";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  pending: "border border-line bg-white text-muted",
  in_stock: "bg-brand/10 text-brand",
  to_order: "bg-warning-bg text-warning",
  ordered: "bg-warning-bg text-warning",
  delivered: "bg-positive/10 text-positive",
  cancelled: "bg-danger-bg text-danger",
};

const TABS = [
  { key: "active", label: "To do" },
  { key: "delivered", label: "Delivered" },
  { key: "all", label: "All" },
];

const ACTIVE = ["pending", "in_stock", "to_order", "ordered"];

export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  const role = profile.role;
  const isDelivery = role === "delivery";
  const canManage = role === "owner" || role === "admin" || role === "staff";
  if (!isDelivery && !canManage) redirect("/");

  const { tab = "active" } = await searchParams;

  const supabase = await createClient();
  const [{ data: rows }, { data: suppliers }] = await Promise.all([
    supabase.from("v_deliveries").select("*").order("contract_date", { ascending: false }).limit(500),
    canManage
      ? supabase.from("suppliers").select("*").order("name")
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const all = rows ?? [];
  const active = all.filter((d) => ACTIVE.includes(d.status));
  const lateInvoices = all.filter((d) => d.days_awaiting_invoice != null && d.days_awaiting_invoice > 14);
  const supplierList = (suppliers ?? []) as { id: string; name: string }[];

  const shown =
    tab === "delivered"
      ? all.filter((d) => d.status === "delivered")
      : tab === "all"
        ? all
        : active;

  const count = (s: string) => active.filter((d) => d.status === s).length;

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-ink">Deliveries</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="To check" value={String(count("pending"))} />
        <StatTile label="To order" value={String(count("to_order"))} />
        <StatTile label="Awaiting supplier" value={String(count("ordered"))} />
        <StatTile label="Late invoices" value={String(lateInvoices.length)} alert={lateInvoices.length > 0} />
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/deliveries?tab=${t.key}`}
            className={`rounded-full px-3.5 py-2 text-xs font-semibold ${
              tab === t.key ? "bg-brand text-white" : "border border-line bg-white text-ink hover:bg-surface"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <SectionCard title={tab === "delivered" ? "Delivered" : "Queue"}>
        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Nothing here.</p>
        ) : (
          <div className="space-y-3">
            {shown.map((d) => {
              const late = d.days_awaiting_invoice != null && d.days_awaiting_invoice > 14;
              // v_deliveries aliases the legacy free text as customer_address;
              // formatAddress/directionsUrl expect it under `address`.
              const located = { ...d, address: d.customer_address };
              const dirUrl = directionsUrl(located);
              const exact = hasExactPin(located);
              return (
                <div key={d.id} className="rounded-card border border-line p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/contracts/${d.contract_id}`} className="font-display font-semibold text-ink hover:underline">
                          {d.customer_name}
                        </Link>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[d.status]}`}>
                          {(DELIVERY_STATUS_LABEL[d.status] ?? d.status).toUpperCase()}
                        </span>
                        {late && (
                          <span className="rounded-full bg-danger-bg px-2 py-0.5 text-[10px] font-semibold text-danger">
                            INVOICE {d.days_awaiting_invoice}d LATE
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted">
                        {d.item_description}
                        {d.quantity > 1 ? ` ×${d.quantity}` : ""} · #{d.contract_no} · {fmtDateShort(d.contract_date)}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted">
                        {formatAddress(located) || "—"}
                        {d.landmark ? ` · near ${d.landmark}` : ""}
                        {d.supplier_name ? ` · supplier: ${d.supplier_name}` : ""}
                        {d.supplier_cost != null ? ` · cost ${peso(d.supplier_cost)}` : ""}
                      </div>
                    </div>
                    {dirUrl && (
                      <a
                        href={dirUrl}
                        target="_blank"
                        className="shrink-0 rounded-card border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface"
                        title={exact ? "Exact tagged location" : "Approximate — from the address"}
                      >
                        Directions{exact ? "" : " ~"}
                      </a>
                    )}
                  </div>
                  {d.status !== "delivered" && d.status !== "cancelled" && (
                    <div className="mt-3">
                      <DeliveryControls
                        delivery={d}
                        suppliers={supplierList}
                        canManage={canManage}
                        isDelivery={isDelivery}
                        contractId={d.contract_id}
                      />
                    </div>
                  )}
                  {d.status === "delivered" && d.delivered_at && (
                    <div className="mt-2 text-xs text-muted">
                      Delivered {fmtDateShort(d.delivered_at)}
                      {d.delivery_note ? ` · ${d.delivery_note}` : ""}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {canManage && (
        <SectionCard
          title="Products & stock"
          action={
            <Link href="/products" className="rounded-card border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface">
              Manage products →
            </Link>
          }
          sub="The product catalog, photos, and stock counts live on the Products page."
        >
          <p className="text-sm text-muted">Stock drops automatically when an in-stock item is delivered.</p>
        </SectionCard>
      )}

      {canManage && (
        <SectionCard title="Suppliers" sub="Vendors you order stock from.">
          <div className="mb-3 space-y-1">
            {supplierList.length === 0 ? (
              <p className="text-sm text-muted">No suppliers yet.</p>
            ) : (
              (suppliers ?? []).map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-card bg-surface px-3 py-2 text-sm">
                  <span className="font-medium text-ink">{s.name}</span>
                  <span className="text-xs text-muted">{s.contact ?? ""}</span>
                </div>
              ))
            )}
          </div>
          <AddSupplierForm />
        </SectionCard>
      )}
    </div>
  );
}
