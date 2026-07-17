"use client";

import { useState, useTransition } from "react";
import { cancelCollectionEntry } from "./actions";

// Cancels a pending entry (collector's own, or owner/admin). Uses a native
// prompt for the optional reason to keep the row compact.
export function CancelEntryButton({ entryId }: { entryId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function onClick() {
    const reason = window.prompt("Cancel this entry? Optional reason:");
    if (reason === null) return; // dismissed
    setError("");
    startTransition(async () => {
      const res = await cancelCollectionEntry(entryId, reason);
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
