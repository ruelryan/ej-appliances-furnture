"use client";

import { useState, useTransition } from "react";
import { addSupplier } from "./actions";
import { btnPrimary, input } from "@/components/ui";

export function AddSupplierForm() {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function action(fd: FormData) {
    setError("");
    const name = String(fd.get("name") ?? "").trim();
    if (!name) return setError("Supplier name is required.");
    start(async () => {
      const res = await addSupplier({
        name,
        contact: String(fd.get("contact") ?? "").trim(),
        address: String(fd.get("address") ?? "").trim(),
        note: String(fd.get("note") ?? "").trim(),
      });
      if (res.error) setError(res.error);
      else (document.getElementById("supplier-form") as HTMLFormElement)?.reset();
    });
  }

  return (
    <form id="supplier-form" action={action} className="space-y-2 border-t border-line pt-3">
      <div className="grid grid-cols-2 gap-2">
        <input name="name" placeholder="Supplier name" required className={input} />
        <input name="contact" placeholder="Contact (optional)" className={input} />
        <input name="address" placeholder="Address (optional)" className={`col-span-2 ${input}`} />
        <input name="note" placeholder="Note (optional)" className={`col-span-2 ${input}`} />
      </div>
      {error && <p className="rounded-card bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Adding…" : "Add supplier"}
      </button>
    </form>
  );
}
