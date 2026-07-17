"use client";

import { useState, useTransition } from "react";
import { rejectLead } from "./actions";

export function RejectButton({ leadId }: { leadId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  function onClick() {
    const reason = window.prompt("Reject this lead? Optional reason:");
    if (reason === null) return;
    setError("");
    start(async () => {
      const res = await rejectLead(leadId, reason);
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
        {pending ? "…" : "Reject"}
      </button>
      {error && <span className="text-[10px] text-danger">{error}</span>}
    </span>
  );
}
