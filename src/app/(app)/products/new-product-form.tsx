"use client";

import { useState, useTransition } from "react";
import { createProduct } from "./actions";
import { ITEM_TYPES } from "@/lib/messages";
import { btnPrimary, input } from "@/components/ui";

export function NewProductForm() {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function action(fd: FormData) {
    setError("");
    const name = String(fd.get("name") ?? "").trim();
    if (!name) return setError("Product name is required.");
    const priceRaw = String(fd.get("price") ?? "").trim();
    const costRaw = String(fd.get("default_cost") ?? "").trim();
    start(async () => {
      const res = await createProduct({
        name,
        category: String(fd.get("category") ?? ""),
        price: priceRaw ? Number(priceRaw) : null,
        defaultCost: costRaw ? Number(costRaw) : null,
      });
      if (res.error) setError(res.error);
      else (document.getElementById("new-product-form") as HTMLFormElement)?.reset();
    });
  }

  return (
    <form id="new-product-form" action={action} className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input name="name" placeholder="Product name" required className={`col-span-2 ${input}`} />
        <select name="category" className={input} defaultValue="">
          <option value="">— category —</option>
          {ITEM_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <input name="price" type="number" step="0.01" min="0" placeholder="Selling price (₱)" className={input} />
        <input name="default_cost" type="number" step="0.01" min="0" placeholder="Supplier cost (optional)" className={`col-span-2 ${input}`} />
      </div>
      {error && <p className="rounded-card bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Adding…" : "Add product"}
      </button>
    </form>
  );
}
