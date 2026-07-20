"use client";

import { useState, useTransition } from "react";
import { submitLead } from "./actions";
import { ITEM_TYPES } from "@/lib/messages";
import { btnPrimary, input, label } from "@/components/ui";

// Agent-facing lead submission form.
export function SubmitLeadForm() {
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();

  function action(fd: FormData) {
    setError("");
    setOk(false);
    const customerName = String(fd.get("customer_name") ?? "").trim();
    const itemDescription = String(fd.get("item_description") ?? "").trim();
    if (!customerName) return setError("Customer name is required.");
    if (!itemDescription) return setError("Item description is required.");
    const priceRaw = String(fd.get("estimated_price") ?? "").trim();

    start(async () => {
      const res = await submitLead({
        customerName,
        phone: String(fd.get("phone") ?? "").trim(),
        address: String(fd.get("address") ?? "").trim(),
        messengerUrl: String(fd.get("messenger_url") ?? "").trim(),
        itemDescription,
        itemType: String(fd.get("item_type") ?? ""),
        estimatedPrice: priceRaw ? Number(priceRaw) : null,
        note: String(fd.get("note") ?? "").trim(),
      });
      if (res.error) setError(res.error);
      else {
        setOk(true);
        (document.getElementById("lead-form") as HTMLFormElement)?.reset();
      }
    });
  }

  return (
    <form id="lead-form" action={action} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <input name="customer_name" placeholder="Customer name" required className={`col-span-2 ${input}`} />
        <input name="phone" placeholder="Phone (optional)" className={input} />
        <input name="messenger_url" placeholder="Messenger link (optional)" className={input} />
        <input name="address" placeholder="Address (optional)" className={`col-span-2 ${input}`} />
        <input name="item_description" placeholder="Item wanted" required className={`col-span-2 ${input}`} />
        <div>
          <label className={label}>Item type</label>
          <select name="item_type" className={input}>
            {ITEM_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Estimated price (₱, optional)</label>
          <input name="estimated_price" type="number" step="0.01" min="0" className={input} />
        </div>
        <input name="note" placeholder="Note (optional)" className={`col-span-2 ${input}`} />
      </div>

      {error && (
        <p className="rounded-card bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>
      )}
      {ok && (
        <p className="rounded-card bg-positive/10 px-3 py-2 text-sm text-positive">
          Lead submitted — the office will review it.
        </p>
      )}

      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Submitting…" : "Submit lead"}
      </button>
    </form>
  );
}
