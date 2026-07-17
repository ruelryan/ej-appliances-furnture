"use client";

import { useState, useTransition } from "react";
import { createProduct, restockProduct, adjustStock } from "./actions";
import { ITEM_TYPES } from "@/lib/messages";
import { peso } from "@/lib/format";
import { btnPrimary, input } from "@/components/ui";

type Product = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  on_hand: number;
  default_cost: number | string | null;
  active: boolean;
};

export function ProductsSection({ products }: { products: Product[] }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function createAction(fd: FormData) {
    setError("");
    const name = String(fd.get("name") ?? "").trim();
    if (!name) return setError("Product name is required.");
    const costRaw = String(fd.get("default_cost") ?? "").trim();
    start(async () => {
      const res = await createProduct({
        name,
        category: String(fd.get("category") ?? ""),
        defaultCost: costRaw ? Number(costRaw) : null,
      });
      if (res.error) setError(res.error);
      else (document.getElementById("product-form") as HTMLFormElement)?.reset();
    });
  }

  function restock(id: string) {
    const raw = window.prompt("Add how many units to stock?");
    if (raw === null) return;
    const qty = Number(raw);
    if (!(qty > 0)) return setError("Enter a positive number.");
    setError("");
    start(async () => {
      const res = await restockProduct(id, qty, "");
      if (res.error) setError(res.error);
    });
  }

  function adjust(id: string) {
    const raw = window.prompt("Adjust on-hand by (e.g. -2 to remove, 5 to add):");
    if (raw === null) return;
    const delta = Number(raw);
    if (!Number.isInteger(delta) || delta === 0) return setError("Enter a non-zero whole number.");
    setError("");
    start(async () => {
      const res = await adjustStock(id, delta, "correction");
      if (res.error) setError(res.error);
    });
  }

  return (
    <div>
      <div className="mb-3 space-y-1">
        {products.length === 0 ? (
          <p className="text-sm text-muted">No products yet.</p>
        ) : (
          products.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-surface px-3 py-2">
              <div className="min-w-0">
                <span className="text-sm font-medium text-ink">{p.name}</span>
                <span className="ml-2 text-xs text-muted">
                  {p.sku}
                  {p.category ? ` · ${p.category}` : ""}
                  {p.default_cost != null ? ` · cost ${peso(p.default_cost)}` : ""}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    p.on_hand > 0 ? "bg-brand/10 text-brand" : "border border-line bg-white text-muted"
                  }`}
                >
                  {p.on_hand} on hand
                </span>
                <button type="button" disabled={pending} onClick={() => restock(p.id)} className="rounded-card border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface disabled:opacity-40">
                  Restock
                </button>
                <button type="button" disabled={pending} onClick={() => adjust(p.id)} className="rounded-card border border-line bg-white px-3 py-1.5 text-xs font-semibold text-muted hover:bg-surface disabled:opacity-40">
                  Adjust
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {error && <p className="mb-2 rounded-card bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}

      <form id="product-form" action={createAction} className="space-y-2 border-t border-line pt-3">
        <div className="grid grid-cols-2 gap-2">
          <input name="name" placeholder="Product name" required className={`col-span-2 ${input}`} />
          <select name="category" className={input} defaultValue="">
            <option value="">— category —</option>
            {ITEM_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <input name="default_cost" type="number" step="0.01" min="0" placeholder="Default cost (optional)" className={input} />
        </div>
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Adding…" : "Add product"}
        </button>
      </form>
    </div>
  );
}
