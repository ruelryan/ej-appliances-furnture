"use client";

import { useEffect, useRef, useState } from "react";
import { productPhotoUrl } from "@/lib/product-photo";
import { peso } from "@/lib/format";
import { input, label } from "@/components/ui";
import { searchProducts, type ProductHit } from "./product-actions";
import { NewItemDialog } from "./new-item-dialog";

export interface PickedProduct {
  id: string;
  name: string;
  category: string | null;
  price: number | null;
}

/**
 * Typeahead over the catalogue with photos, so the item can be confirmed by eye
 * before it goes on a contract.
 *
 * Follows the searchCustomers debounce pattern but fixes two gaps in it: an
 * in-flight request is cancelled when the term changes (otherwise a slow early
 * response can land after a fast later one and clobber the results), and there
 * is a visible loading state instead of a silently stale list.
 */
export function ProductPicker({
  onPick,
  picked,
}: {
  onPick: (p: PickedProduct | null) => void;
  picked: PickedProduct | null;
}) {
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [preview, setPreview] = useState<ProductHit | null>(null);
  const [adding, setAdding] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (picked) return;
    const q = term.trim();
    if (q.length < 2) {
      // Reset inside the timeout rather than synchronously in the effect body:
      // a synchronous setState here triggers a cascading render, which is what
      // the react-hooks lint rule flags in the older forms in this codebase.
      const t = setTimeout(() => {
        setHits([]);
        setSearched(false);
        setSearching(false);
      }, 0);
      return () => clearTimeout(t);
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const mine = ++seq.current;
      setSearching(true);
      const res = await searchProducts(q);
      if (mine !== seq.current) return; // a newer search already answered
      setHits(res);
      setSearching(false);
      setSearched(true);
    }, 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [term, picked]);

  function choose(h: ProductHit) {
    onPick({ id: h.id, name: h.name, category: h.category, price: h.price });
    setTerm("");
    setHits([]);
    setSearched(false);
  }

  if (picked) {
    return (
      <div className="col-span-2">
        <label className={label}>Item from catalog</label>
        <div className="flex items-center justify-between gap-2 rounded-card border border-brand bg-brand/5 p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{picked.name}</p>
            <p className="text-xs text-muted">
              {picked.category ?? "Uncategorised"}
              {picked.price != null ? ` · ${peso(picked.price)}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onPick(null)}
            className="shrink-0 rounded-card border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative col-span-2">
      <label className={label} htmlFor="product_search">
        Item <span className="text-muted">(search the catalog)</span>
      </label>
      <input
        id="product_search"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Type the item — e.g. washing machine, sala set, ref"
        className={input}
        autoComplete="off"
      />

      {term.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-96 w-full overflow-y-auto rounded-card border border-line bg-white shadow-xl">
          {searching && (
            <p className="px-3 py-3 text-xs text-muted">Searching…</p>
          )}

          {!searching &&
            hits.map((h) => (
              <div
                key={h.id}
                className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-0 hover:bg-surface"
              >
                {h.storage_path ? (
                  <button
                    type="button"
                    onClick={() => setPreview(h)}
                    title="Tap to see the photo larger"
                    className="shrink-0"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={productPhotoUrl(h.storage_path)}
                      alt={h.name}
                      className="h-12 w-12 rounded-card border border-line object-cover"
                    />
                  </button>
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-card border border-dashed border-line text-[10px] text-muted">
                    no photo
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => choose(h)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-medium text-ink">{h.name}</p>
                  <p className="text-xs text-muted">
                    {h.price != null ? peso(h.price) : "no price"} · stock {h.on_hand}
                    {h.review_status === "pending" ? " · unreviewed" : ""}
                  </p>
                </button>
              </div>
            ))}

          {!searching && searched && hits.length === 0 && (
            <p className="px-3 py-3 text-xs text-muted">
              Nothing matching &ldquo;{term.trim()}&rdquo; in the catalog.
            </p>
          )}

          {!searching && searched && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="w-full border-t border-line px-3 py-2.5 text-left text-sm font-semibold text-brand hover:bg-surface"
            >
              + Not in the list — add &ldquo;{term.trim()}&rdquo;
            </button>
          )}
        </div>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setPreview(null)}
        >
          <div
            className="w-full max-w-sm rounded-card bg-white p-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={productPhotoUrl(preview.storage_path!)}
              alt={preview.name}
              className="mb-3 max-h-[60vh] w-full rounded-card object-contain"
            />
            <p className="text-sm font-semibold text-ink">{preview.name}</p>
            <p className="mb-3 text-xs text-muted">
              {preview.sku}
              {preview.price != null ? ` · ${peso(preview.price)}` : ""} · stock {preview.on_hand}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  choose(preview);
                  setPreview(null);
                }}
                className="flex-1 rounded-card bg-brand py-2 text-sm font-semibold text-white hover:bg-brand-dark"
              >
                Use this item
              </button>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="flex-1 rounded-card border border-line py-2 text-sm font-semibold text-ink hover:bg-surface"
              >
                Not this one
              </button>
            </div>
          </div>
        </div>
      )}

      {adding && (
        <NewItemDialog
          initialName={term.trim()}
          onClose={() => setAdding(false)}
          onCreated={(p) => {
            setAdding(false);
            onPick(p);
            setTerm("");
            setHits([]);
          }}
        />
      )}
    </div>
  );
}
