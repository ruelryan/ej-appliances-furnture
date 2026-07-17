import { SectionCard } from "@/components/section-card";
import { peso, fmtDateShort } from "@/lib/format";
import { DeliveryControls, type DeliveryRow } from "@/app/(app)/deliveries/delivery-controls";

export const DELIVERY_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  in_stock: "In stock — ready to deliver",
  to_order: "To order from supplier",
  ordered: "Ordered from supplier",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const STATUS_STYLE: Record<string, string> = {
  pending: "border border-line bg-white text-muted",
  in_stock: "bg-brand/10 text-brand",
  to_order: "bg-warning-bg text-warning",
  ordered: "bg-warning-bg text-warning",
  delivered: "bg-positive/10 text-positive",
  cancelled: "bg-danger-bg text-danger",
};

type DeliveryDisplay = DeliveryRow & {
  supplier_name?: string | null;
  delivered_at?: string | null;
  delivery_note?: string | null;
};

export function DeliveryPanel({
  delivery,
  suppliers,
  products,
  canManage,
  isDelivery,
  contractId,
}: {
  delivery: DeliveryDisplay | null;
  suppliers: { id: string; name: string }[];
  products: { id: string; name: string }[];
  canManage: boolean;
  isDelivery: boolean;
  contractId: string;
}) {
  if (!delivery) {
    return (
      <SectionCard title="Delivery">
        <p className="text-xs text-muted">No delivery record for this contract.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Delivery">
      <dl className="space-y-1.5 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted">Status</dt>
          <dd>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                STATUS_STYLE[delivery.status]
              }`}
            >
              {(DELIVERY_STATUS_LABEL[delivery.status] ?? delivery.status).toUpperCase()}
            </span>
          </dd>
        </div>
        {delivery.supplier_name && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Supplier</dt>
            <dd className="text-right text-ink">
              {delivery.supplier_name}
              {delivery.supplier_cost != null ? ` · ${peso(delivery.supplier_cost)}` : ""}
            </dd>
          </div>
        )}
        {delivery.ordered_at && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Ordered</dt>
            <dd className="text-right text-ink">
              {fmtDateShort(delivery.ordered_at)}
              {delivery.invoice_received_at
                ? ` · invoice ${fmtDateShort(delivery.invoice_received_at)}${delivery.invoice_ref ? ` (${delivery.invoice_ref})` : ""}`
                : " · invoice pending"}
            </dd>
          </div>
        )}
        {delivery.delivered_at && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Delivered</dt>
            <dd className="text-right text-ink">
              {fmtDateShort(delivery.delivered_at)}
              {delivery.delivery_note ? ` · ${delivery.delivery_note}` : ""}
            </dd>
          </div>
        )}
      </dl>

      {(canManage || isDelivery) && (
        <div className="mt-3">
          <DeliveryControls
            delivery={delivery}
            suppliers={suppliers}
            products={products}
            canManage={canManage}
            isDelivery={isDelivery}
            contractId={contractId}
          />
        </div>
      )}
    </SectionCard>
  );
}
