"use client";

import { useState, useTransition } from "react";
import { linkCollectionPayment } from "./actions";

// Closes a collector's entry against a payment the admin already recorded on
// the Contracts tab. Creates nothing — it only records that the two rows are
// the same money, which is what stops a second payment being posted for it.
export function LinkPaymentButton({
  entryId,
  paymentId,
  paymentNo,
}: {
  entryId: string;
  paymentId: string;
  paymentNo: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function onClick() {
    const ok = window.confirm(
      `Link this entry to ${paymentNo}?\n\nThis records that they are the same money. No new payment is created and the customer's balance does not change.`
    );
    if (!ok) return;
    setError("");
    startTransition(async () => {
      const res = await linkCollectionPayment({ entryId, paymentId });
      if (res.error) setError(res.error);
    });
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-card bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
      >
        {pending ? "Linking…" : `Link ${paymentNo}`}
      </button>
      {error && <span className="text-micro text-danger">{error}</span>}
    </span>
  );
}
