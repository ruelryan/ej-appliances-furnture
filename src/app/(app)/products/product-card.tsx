"use client";

import { useRef, useState, useTransition } from "react";
import {
  updateProduct,
  restockProduct,
  adjustStock,
  uploadProductPhoto,
  deleteProductPhoto,
} from "./actions";
import { productPhotoUrl } from "@/lib/product-photo";
import { peso } from "@/lib/format";
import { ITEM_TYPES } from "@/lib/messages";
import { input, label } from "@/components/ui";

type Photo = { id: string; storage_path: string };
export type Product = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  price: number | string | null;
  default_cost: number | string | null;
  on_hand: number;
  active: boolean;
  product_photos?: Photo[];
};

export function ProductCard({ product }: { product: Product }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // edit form state
  const [name, setName] = useState(product.name);
  const [category, setCategory] = useState(product.category ?? "");
  const [price, setPrice] = useState(product.price != null ? String(product.price) : "");
  const [cost, setCost] = useState(product.default_cost != null ? String(product.default_cost) : "");
  const [active, setActive] = useState(product.active);

  const photos = product.product_photos ?? [];

  function run(fn: () => Promise<{ error?: string }>, done?: () => void) {
    setError("");
    start(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else done?.();
    });
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    run(() => uploadProductPhoto(product.id, fd), () => {
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  function restock() {
    const raw = window.prompt("Add how many units to stock?");
    if (raw === null) return;
    const qty = Number(raw);
    if (!(qty > 0)) return setError("Enter a positive number.");
    run(() => restockProduct(product.id, qty, ""));
  }
  function adjust() {
    const raw = window.prompt("Adjust on-hand by (e.g. -2 or 5):");
    if (raw === null) return;
    const delta = Number(raw);
    if (!Number.isInteger(delta) || delta === 0) return setError("Enter a non-zero whole number.");
    run(() => adjustStock(product.id, delta, "correction"));
  }

  return (
    <div className={`rounded-card border border-line p-3 ${product.active ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-display font-semibold text-ink">{product.name}</span>
            {!product.active && (
              <span className="rounded-full bg-danger-bg px-2 py-0.5 text-[10px] font-semibold text-danger">
                INACTIVE
              </span>
            )}
          </div>
          <div className="text-xs text-muted">
            {product.sku}
            {product.category ? ` · ${product.category}` : ""}
            {product.price != null ? ` · price ${peso(product.price)}` : ""}
            {product.default_cost != null ? ` · cost ${peso(product.default_cost)}` : ""}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              product.on_hand > 0 ? "bg-brand/10 text-brand" : "border border-line bg-white text-muted"
            }`}
          >
            {product.on_hand} on hand
          </span>
        </div>
      </div>

      {/* Photos */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {photos.map((ph) => (
          <div key={ph.id} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={productPhotoUrl(ph.storage_path)}
              alt={product.name}
              className="h-16 w-16 rounded-card border border-line object-cover"
            />
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => deleteProductPhoto(ph.id))}
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-danger text-[11px] font-bold text-white disabled:opacity-40"
              title="Delete photo"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={pending}
          onClick={() => fileRef.current?.click()}
          className="flex h-16 w-16 items-center justify-center rounded-card border border-dashed border-line text-xs text-muted hover:bg-surface disabled:opacity-40"
        >
          {pending ? "…" : "+ Photo"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      </div>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => setEditing(true)} className="rounded-card border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface">
          Edit
        </button>
        <button type="button" disabled={pending} onClick={restock} className="rounded-card border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface disabled:opacity-40">
          Restock
        </button>
        <button type="button" disabled={pending} onClick={adjust} className="rounded-card border border-line bg-white px-3 py-1.5 text-xs font-semibold text-muted hover:bg-surface disabled:opacity-40">
          Adjust
        </button>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(false)}>
          <div className="w-full max-w-sm rounded-card bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-base font-semibold text-ink">Edit product</h3>
            <label className={label}>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={`${input} mb-3`} />
            <label className={label}>Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${input} mb-3`}>
              <option value="">— none —</option>
              {ITEM_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <div>
                <label className={label}>Price (₱)</label>
                <input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} className={input} />
              </div>
              <div>
                <label className={label}>Cost (₱)</label>
                <input type="number" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)} className={input} />
              </div>
            </div>
            <label className="mb-3 flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Active (available for new sales)
            </label>
            {error && <p className="mb-3 rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setEditing(false)} className="flex-1 rounded-card border border-line py-2 text-sm font-semibold text-ink hover:bg-surface">
                Cancel
              </button>
              <button
                type="button"
                disabled={pending || !name.trim()}
                onClick={() =>
                  run(
                    () =>
                      updateProduct(product.id, {
                        name: name.trim(),
                        category,
                        price: price.trim() ? Number(price) : null,
                        defaultCost: cost.trim() ? Number(cost) : null,
                        active,
                      }),
                    () => setEditing(false)
                  )
                }
                className="flex-1 rounded-card bg-brand py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
