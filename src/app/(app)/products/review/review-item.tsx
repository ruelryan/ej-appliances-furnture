"use client";

import { useState, useTransition } from "react";
import { peso } from "@/lib/format";
import { productPhotoUrl } from "@/lib/product-photo";
import { hammingDistance } from "@/lib/image";
import { SectionCard } from "@/components/section-card";
import { btnPrimary, btnSecondary, btnDanger } from "@/components/ui";
import { approveProduct, mergeProducts } from "../actions";

export interface PendingProduct {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  price: number | null;
  on_hand: number;
  description: string | null;
  product_photos: Array<{ id: string; storage_path: string; sort_order: number; dhash: string | null }>;
}

export interface Candidate {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  price: number | null;
  on_hand: number;
  storage_path: string | null;
  dhash: string | null;
  name_score: number;
}

function Photo({ path, alt, size }: { path: string | null; alt: string; size: string }) {
  if (!path) {
    return (
      <div className={`${size} flex items-center justify-center rounded-card border border-dashed border-line text-xs text-muted`}>
        no photo
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={productPhotoUrl(path)} alt={alt} className={`${size} rounded-card border border-line object-cover`} />
  );
}

export function ReviewItem({
  product,
  candidates,
}: {
  product: PendingProduct;
  candidates: Candidate[];
}) {
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const primary = [...product.product_photos].sort((a, b) => a.sort_order - b.sort_order)[0];
  const newHash = primary?.dhash ?? null;

  // CALIBRATED AGAINST THE REAL CATALOGUE — do not restore the textbook
  // thresholds. Across all 8,911 photo pairs the closest was 2 bits and the 5th
  // percentile was 19. Every one of the closest pairs is a DIFFERENT product:
  // 2 bits between two Acer laptops, 4 between an HP and an Acer, 4 between a
  // 1.5 HP and a 0.75 HP aircon. These are white-background studio shots with
  // near-identical silhouettes, so dHash barely separates same-category items.
  //
  // The usual "<=5 means duplicate" would therefore flag ten unrelated pairs.
  // What a low distance DOES catch reliably is the same image file uploaded
  // twice — the realistic duplicate here, since a re-added item usually reuses
  // the supplier's photo. So the photo signal is trusted only at <=2, and name
  // similarity leads the ranking.
  const PHOTO_SAME_FILE = 2;

  const scored = candidates
    .map((c) => {
      const dist = newHash && c.dhash ? hammingDistance(newHash, c.dhash) : null;
      return { ...c, dist };
    })
    .sort((a, b) => {
      const ai = a.dist !== null && a.dist <= PHOTO_SAME_FILE ? 0 : 1;
      const bi = b.dist !== null && b.dist <= PHOTO_SAME_FILE ? 0 : 1;
      if (ai !== bi) return ai - bi;
      if (ai === 0) return (a.dist ?? 64) - (b.dist ?? 64);
      return b.name_score - a.name_score;
    });

  function keep() {
    setError("");
    startTransition(async () => {
      const res = await approveProduct(product.id);
      if (res.error) setError(res.error);
    });
  }

  function merge(keepId: string) {
    setError("");
    startTransition(async () => {
      const res = await mergeProducts(product.id, keepId);
      if (res.error) setError(res.error);
      setConfirming(null);
    });
  }

  function verdict(dist: number | null, nameScore: number): { text: string; tone: string } {
    if (dist !== null && dist <= PHOTO_SAME_FILE)
      return { text: "Same photo — almost certainly the same item", tone: "text-danger" };
    if (nameScore >= 0.6) return { text: "Very similar name", tone: "text-warning" };
    if (nameScore >= 0.35) return { text: "Somewhat similar name", tone: "text-muted" };
    return { text: "Probably unrelated", tone: "text-muted" };
  }

  /**
   * Deliberately does not present a middling photo distance as evidence.
   * Catalogue shots of the same category sit 3-10 bits apart whether or not
   * they are the same product, so calling that "similar" would mislead.
   */
  function photoNote(dist: number | null): string {
    if (dist === null) return "no photo to compare";
    if (dist <= PHOTO_SAME_FILE) return `same image (${dist}/64 bits apart)`;
    if (dist <= 10) return "different image, similar shape";
    return "different image";
  }

  return (
    <SectionCard
      title={`New item · ${product.sku}`}
      sub="Compare against the closest existing items before deciding."
      action={
        <button type="button" onClick={keep} disabled={busy} className={btnPrimary}>
          {busy ? "Saving…" : "Keep as new"}
        </button>
      }
    >
      {error && (
        <p className="mb-3 rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">{error}</p>
      )}

      <div className="mb-4 flex items-start gap-3 rounded-card border border-brand bg-brand/5 p-3">
        <Photo path={primary?.storage_path ?? null} alt={product.name} size="h-24 w-24" />
        <div className="min-w-0">
          <p className="font-semibold text-ink">{product.name}</p>
          <p className="text-xs text-muted">
            {product.category ?? "Uncategorised"}
            {product.price != null ? ` · ${peso(product.price)}` : " · no price"} · stock {product.on_hand}
          </p>
          {product.description && (
            <p className="mt-1 line-clamp-2 text-xs text-muted">{product.description}</p>
          )}
          {!primary && (
            <p className="mt-1 text-xs text-warning">
              No photo — only the name can be compared.
            </p>
          )}
        </div>
      </div>

      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
        Closest existing items
      </p>

      {scored.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">
          Nothing similar in the catalog — safe to keep.
        </p>
      ) : (
        <div className="space-y-2">
          {scored.map((c) => {
            const v = verdict(c.dist, c.name_score);
            return (
              <div key={c.id} className="rounded-card border border-line p-3">
                <div className="flex items-start gap-3">
                  <Photo path={c.storage_path} alt={c.name} size="h-20 w-20" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{c.name}</p>
                    <p className="text-xs text-muted">
                      {c.sku}
                      {c.price != null ? ` · ${peso(c.price)}` : ""} · stock {c.on_hand}
                    </p>
                    <p className={`mt-1 text-xs font-medium ${v.tone}`}>
                      {v.text}
                      <span className="ml-1 font-normal text-muted">
                        (name {Math.round(c.name_score * 100)}% · {photoNote(c.dist)})
                      </span>
                    </p>
                  </div>
                </div>

                {confirming === c.id ? (
                  <div className="mt-3 rounded-card bg-danger-bg p-3">
                    <p className="mb-2 text-xs text-danger">
                      Merge <strong>{product.name}</strong> into <strong>{c.name}</strong>? Any
                      contract using the new item is repointed, its photos and stock move across,
                      and the new item is deleted. This cannot be undone.
                    </p>
                    <div className="flex gap-2">
                      <button type="button" disabled={busy} onClick={() => merge(c.id)} className={btnDanger}>
                        {busy ? "Merging…" : "Yes, merge"}
                      </button>
                      <button type="button" onClick={() => setConfirming(null)} className={btnSecondary}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(c.id)}
                    className={`mt-2 ${btnSecondary}`}
                  >
                    Same item — merge into this
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
