"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import {
  setDeliveryAvailability,
  recordSupplierOrder,
  recordSupplierInvoice,
  markDelivered,
  setDeliveryProduct,
} from "./actions";
import { phTodayISO } from "@/lib/format";
import { input, label } from "@/components/ui";

export type DeliveryRow = {
  id: string;
  status: string;
  supplier_id: string | null;
  supplier_cost: number | string | null;
  ordered_at: string | null;
  paid_at: string | null;
  invoice_received_at: string | null;
  invoice_ref: string | null;
  product_id?: string | null;
};

type Supplier = { id: string; name: string };
type Product = { id: string; name: string };

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-card bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-base font-semibold text-ink">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function DeliveryControls({
  delivery,
  suppliers,
  products,
  canManage,
  isDelivery,
  contractId,
}: {
  delivery: DeliveryRow;
  suppliers: Supplier[];
  products?: Product[];
  canManage: boolean;
  isDelivery: boolean;
  contractId?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [orderOpen, setOrderOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);

  // order form
  const [supplierId, setSupplierId] = useState(delivery.supplier_id ?? "");
  const [cost, setCost] = useState(delivery.supplier_cost != null ? String(delivery.supplier_cost) : "");
  const [orderedAt, setOrderedAt] = useState(delivery.ordered_at ?? phTodayISO());
  const [paidAt, setPaidAt] = useState(delivery.paid_at ?? "");
  // invoice form
  const [invoiceRef, setInvoiceRef] = useState(delivery.invoice_ref ?? "");
  const [receivedAt, setReceivedAt] = useState(delivery.invoice_received_at ?? phTodayISO());

  const canAct = isDelivery || canManage;
  const s = delivery.status;
  const done = s === "delivered" || s === "cancelled";

  function run(fn: () => Promise<{ error?: string }>, close?: () => void) {
    setError("");
    start(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else close?.();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Availability */}
      {canAct && (s === "pending" || s === "in_stock" || s === "to_order") && (
        <>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => setDeliveryAvailability(delivery.id, true, contractId))}
            className={`rounded-card px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${
              s === "in_stock" ? "bg-brand/10 text-brand" : "border border-line bg-white text-ink hover:bg-surface"
            }`}
          >
            In stock
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => setDeliveryAvailability(delivery.id, false, contractId))}
            className={`rounded-card px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${
              s === "to_order" ? "bg-brand/10 text-brand" : "border border-line bg-white text-ink hover:bg-surface"
            }`}
          >
            To order
          </button>
        </>
      )}

      {/* Supplier order (office) */}
      {canManage && !done && (
        <button
          type="button"
          onClick={() => setOrderOpen(true)}
          className="rounded-card border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface"
        >
          {delivery.supplier_id ? "Edit supplier order" : "Record supplier order"}
        </button>
      )}

      {/* Invoice (office) */}
      {canManage && s === "ordered" && (
        <button
          type="button"
          onClick={() => setInvoiceOpen(true)}
          className={`rounded-card px-3 py-1.5 text-xs font-semibold ${
            delivery.invoice_received_at
              ? "border border-line bg-white text-ink hover:bg-surface"
              : "bg-warning-bg text-warning hover:bg-warning-bg/70"
          }`}
        >
          {delivery.invoice_received_at ? "Invoice ✓" : "Record invoice"}
        </button>
      )}

      {/* Link a catalog product (so stock decrements on delivery) */}
      {products && products.length > 0 && canAct && !done && (
        <select
          value={delivery.product_id ?? ""}
          disabled={pending}
          onChange={(e) => run(() => setDeliveryProduct(delivery.id, e.target.value || null, contractId))}
          className="rounded-card border border-line bg-white px-2 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
          title="Link a catalog product"
        >
          <option value="">No product</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}

      {/* Delivered */}
      {canAct && !done && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            const note = window.prompt("Delivery note (optional):") ?? "";
            run(() => markDelivered(delivery.id, note, contractId));
          }}
          className="rounded-card bg-positive px-3 py-1.5 text-xs font-semibold text-white hover:bg-positive-dark disabled:opacity-40"
        >
          Mark delivered
        </button>
      )}

      {error && <span className="text-[10px] text-danger">{error}</span>}

      {orderOpen && (
        <Modal title="Supplier order" onClose={() => setOrderOpen(false)}>
          <label className={label}>Supplier</label>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={`${input} mb-3`}>
            <option value="">— none —</option>
            {suppliers.map((sup) => (
              <option key={sup.id} value={sup.id}>
                {sup.name}
              </option>
            ))}
          </select>
          <label className={label}>Cost (₱ paid to supplier)</label>
          <input type="number" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)} className={`${input} mb-3`} />
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div>
              <label className={label}>Ordered</label>
              <input type="date" value={orderedAt} onChange={(e) => setOrderedAt(e.target.value)} className={input} />
            </div>
            <div>
              <label className={label}>Paid (optional)</label>
              <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className={input} />
            </div>
          </div>
          {error && <p className="mb-3 rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setOrderOpen(false)} className="flex-1 rounded-card border border-line py-2 text-sm font-semibold text-ink hover:bg-surface">
              Cancel
            </button>
            <button
              type="button"
              disabled={pending || !(Number(cost) >= 0 && cost !== "")}
              onClick={() =>
                run(
                  () =>
                    recordSupplierOrder(
                      delivery.id,
                      { supplierId: supplierId || null, cost: Number(cost), orderedAt, paidAt },
                      contractId
                    ),
                  () => setOrderOpen(false)
                )
              }
              className="flex-1 rounded-card bg-brand py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </Modal>
      )}

      {invoiceOpen && (
        <Modal title="Supplier invoice" onClose={() => setInvoiceOpen(false)}>
          <label className={label}>Invoice reference</label>
          <input value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} placeholder="Invoice / SI no." className={`${input} mb-3`} />
          <label className={label}>Received</label>
          <input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} className={`${input} mb-3`} />
          {error && <p className="mb-3 rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setInvoiceOpen(false)} className="flex-1 rounded-card border border-line py-2 text-sm font-semibold text-ink hover:bg-surface">
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  () => recordSupplierInvoice(delivery.id, { invoiceRef, receivedAt }, contractId),
                  () => setInvoiceOpen(false)
                )
              }
              className="flex-1 rounded-card bg-brand py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
