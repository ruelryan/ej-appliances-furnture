"use client";

import { useState, useTransition } from "react";
import { unlinkCollectionPayment } from "./actions";

// Separates a posted entry from the payment it was closed against, returning it
// to the to-post queue. The remedy for two situations that previously had none:
// a mis-link, and the entry left stranded when the owner voids a payment that
// came from a collection. Admin may unlink an already-voided payment; a live
// one is owner-only, enforced in SQL (0031).
export function UnlinkEntryButton({
  entryId,
  paymentNo,
  paymentVoided,
}: {
  entryId: string;
  paymentNo: string | null;
  paymentVoided: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function onClick() {
    const reason = window.prompt(
      paymentVoided
        ? `${paymentNo ?? "That payment"} was voided. Return this collection to the to-post queue? Optional reason:`
        : `${paymentNo ?? "That payment"} is still live. Unlinking says the payment and this collection are NOT the same money — the collection goes back to the to-post queue. Optional reason:`
    );
    if (reason === null) return; // dismissed
    setError("");
    startTransition(async () => {
      const res = await unlinkCollectionPayment(entryId, reason);
      if (res.error) setError(res.error);
    });
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-card border border-line px-3 py-1.5 text-xs font-semibold text-muted hover:bg-surface hover:text-danger disabled:opacity-40"
      >
        {pending ? "…" : "Unlink"}
      </button>
      {error && <span className="text-micro text-danger">{error}</span>}
    </span>
  );
}
