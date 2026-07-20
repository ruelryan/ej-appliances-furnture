"use client";

import { useState, useTransition } from "react";
import { ITEM_TYPES } from "@/lib/messages";
import { processImage, type ProcessedImage } from "@/lib/image";
import { btnPrimary, btnSecondary, input, label } from "@/components/ui";
import { createProductForContract, uploadProductPhotoWithHash } from "./product-actions";
import type { PickedProduct } from "./product-picker";

/**
 * Adds a catalogue item without leaving the contract form.
 *
 * The product is created first because a photo's storage path is keyed by
 * product id. The photo is optional and its failure is non-fatal: the sale must
 * not be held up by an upload, and a missing photo only means the reviewer has
 * less to compare against later.
 */
export function NewItemDialog({
  initialName,
  onClose,
  onCreated,
}: {
  initialName: string;
  onClose: () => void;
  onCreated: (p: PickedProduct) => void;
}) {
  const [name, setName] = useState(initialName);
  const [category, setCategory] = useState<string>(ITEM_TYPES[0] ?? "");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<ProcessedImage | null>(null);
  const [photoError, setPhotoError] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  async function pickPhoto(file: File | undefined) {
    setPhotoError("");
    if (!file) return;
    try {
      setPhoto(await processImage(file));
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : "Could not read that image.");
    }
  }

  function save() {
    setError("");
    if (!name.trim()) return setError("Give the item a name.");
    const p = price.trim() ? Number(price) : null;
    if (p !== null && (!isFinite(p) || p <= 0)) return setError("Price must be a number above zero.");

    startTransition(async () => {
      const res = await createProductForContract({
        name: name.trim(),
        category,
        price: p,
        description: description.trim(),
      });
      if (res.error || !res.product) return setError(res.error ?? "Could not add the item.");

      if (photo) {
        const fd = new FormData();
        fd.append("file", photo.file);
        const up = await uploadProductPhotoWithHash(res.product.id, fd, photo.hash);
        // Non-fatal on purpose — the item exists and the contract can proceed.
        if (up.error) setPhotoError(`Item added, but the photo failed: ${up.error}`);
      }

      onCreated({
        id: res.product.id,
        name: res.product.name,
        category,
        price: res.product.price ?? p,
      });
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-card bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-base font-semibold text-ink">Add a new item</h3>
        <p className="mb-3 text-xs text-muted">
          The contract saves straight away. The admin checks afterwards that this
          is not already in the catalog under another name.
        </p>

        <label className={label} htmlFor="ni_name">Item name</label>
        <input
          id="ni_name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Haier Washing Machine 8 kg Twin Tub HW-80"
          className={`${input} mb-3`}
          autoFocus
        />

        <label className={label} htmlFor="ni_category">Type</label>
        <select
          id="ni_category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={`${input} mb-3`}
        >
          {ITEM_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <label className={label} htmlFor="ni_price">Cash price</label>
        <input
          id="ni_price"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="0.00"
          className={`${input} mb-3`}
        />

        <label className={label} htmlFor="ni_desc">Specification (optional)</label>
        <input
          id="ni_desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Capacity, model, finish…"
          className={`${input} mb-3`}
        />

        <label className={label} htmlFor="ni_photo">Photo</label>
        <input
          id="ni_photo"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => pickPhoto(e.target.files?.[0])}
          className={`${input} mb-2`}
        />
        {photo && (
          <div className="mb-3 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.dataUrl}
              alt="Selected"
              className="h-16 w-16 rounded-card border border-line object-cover"
            />
            <p className="text-xs text-muted">
              Resized {photo.originalKb} KB → <strong>{photo.processedKb} KB</strong>
            </p>
          </div>
        )}
        {photoError && <p className="mb-3 text-xs text-danger">{photoError}</p>}
        {error && (
          <p className="mb-3 rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">{error}</p>
        )}

        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={`flex-1 ${btnSecondary}`}>
            Cancel
          </button>
          <button type="button" onClick={save} disabled={pending} className={`flex-1 ${btnPrimary}`}>
            {pending ? "Adding…" : "Add and use"}
          </button>
        </div>
      </div>
    </div>
  );
}
