"use client";

import { useState, useTransition } from "react";
import { cancelRemittance } from "./actions";

// Owner-only. A remittance is never deleted — cancelling leaves the row with
// its reason, and the money returns to the collector's running balance.
export function CancelRemittanceButton({
  remittanceId,
  remitNo,
}: {
  remittanceId: string;
  remitNo: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function onClick() {
    const reason = window.prompt(
      `Cancel ${remitNo}? The amount goes back to the collector's cash on hand. Optional reason:`
    );
    if (reason === null) return; // dismissed
    setError("");
    startTransition(async () => {
      const res = await cancelRemittance(remittanceId, reason);
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
        {pending ? "…" : "Cancel"}
      </button>
      {error && <span className="text-[10px] text-danger">{error}</span>}
    </span>
  );
}
