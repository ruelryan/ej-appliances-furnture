"use client";

import { useState, useTransition } from "react";
import { markCommissionPaid } from "./actions";

export function MarkPaidButton({ commissionId }: { commissionId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  function onClick() {
    const ref = window.prompt("Payout reference (e.g. GCash ref):");
    if (ref === null) return;
    setError("");
    start(async () => {
      const res = await markCommissionPaid(commissionId, ref);
      if (res.error) setError(res.error);
    });
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-card bg-positive px-3 py-1.5 text-xs font-semibold text-white hover:bg-positive-dark disabled:opacity-40"
      >
        {pending ? "…" : "Mark paid"}
      </button>
      {error && <span className="text-[10px] text-danger">{error}</span>}
    </span>
  );
}
