"use client";

import { useEffect, useState, useTransition } from "react";
import { requestTimeCorrection } from "./actions";

// Staff: propose corrected times for a day; the owner approves or rejects.
export function RequestFixDialog({
  workDate,
  dateLabel,
  timeIn,
  timeOut,
}: {
  workDate: string;
  dateLabel: string;
  timeIn: string | null;
  timeOut: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [inVal, setInVal] = useState(timeIn?.slice(0, 5) ?? "");
  const [outVal, setOutVal] = useState(timeOut?.slice(0, 5) ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function submit() {
    startTransition(async () => {
      const res = await requestTimeCorrection({
        workDate,
        timeIn: inVal,
        timeOut: outVal,
        reason: reason.trim(),
      });
      if (res.error) setError(res.error);
      else {
        setOpen(false);
        setReason("");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError("");
          setInVal(timeIn?.slice(0, 5) ?? "");
          setOutVal(timeOut?.slice(0, 5) ?? "");
          setOpen(true);
        }}
        className="rounded-card border border-line px-2 py-1 text-xs font-semibold text-muted hover:bg-surface hover:text-ink"
      >
        Fix
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-card bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-base font-semibold text-ink">
              Request a fix — {dateLabel}
            </h3>
            <p className="mb-3 text-xs text-muted">
              The owner will review this before your times change.
            </p>

            <div className="mb-3 grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink">
                  Correct time in
                </label>
                <input
                  type="time"
                  value={inVal}
                  onChange={(e) => setInVal(e.target.value)}
                  className="w-full rounded-card border border-line px-3 py-2.5 text-base"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink">
                  Correct time out
                </label>
                <input
                  type="time"
                  value={outVal}
                  onChange={(e) => setOutVal(e.target.value)}
                  className="w-full rounded-card border border-line px-3 py-2.5 text-base"
                />
              </div>
            </div>

            <label className="mb-1 block text-xs font-medium text-ink">
              Reason (required)
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. forgot to clock out, phone died"
              autoFocus
              className="mb-3 w-full rounded-card border border-line px-3 py-2.5 text-base"
            />

            {error && (
              <p className="mb-3 rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 rounded-card border border-line py-2 text-sm font-semibold text-ink hover:bg-surface"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending || !inVal || !reason.trim()}
                className="flex-1 rounded-card bg-brand py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
              >
                {pending ? "Sending…" : "Send request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
