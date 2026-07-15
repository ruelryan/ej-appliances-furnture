"use client";

import { useEffect, useState, useTransition } from "react";
import { unvoidPayment, voidPayment } from "./actions";
import { peso, fmtDateShort } from "@/lib/format";

export function VoidPaymentButton({
  paymentId,
  paymentNo,
  customerName,
  amount,
  paymentDate,
}: {
  paymentId: string;
  paymentNo: string;
  customerName: string;
  amount: number;
  paymentDate: string;
}) {
  const [open, setOpen] = useState(false);
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

  function confirm() {
    startTransition(async () => {
      const res = await voidPayment(paymentId, reason.trim());
      if (res.error) {
        setError(res.error);
      } else {
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
          setOpen(true);
        }}
        className="rounded-card border border-danger/40 px-2 py-1 text-xs font-semibold text-danger hover:bg-danger-bg"
      >
        Void
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
            <h3 className="mb-1 text-base font-bold text-danger">
              Void this payment?
            </h3>
            <p className="mb-3 text-xs text-muted">
              It will stop counting toward the balance. You can restore it
              later if this is a mistake.
            </p>

            <div className="mb-3 rounded-card bg-surface p-3 text-sm">
              <div className="font-semibold text-navy">
                {customerName}
              </div>
              <div className="text-xs text-muted">
                <span className="font-mono">{paymentNo}</span> ·{" "}
                {fmtDateShort(paymentDate)}
              </div>
              <div className="mt-1 text-lg font-bold text-navy">
                {peso(amount)}
              </div>
            </div>

            <label className="mb-1 block text-xs font-medium text-navy">
              Reason (required)
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. duplicate entry, wrong amount"
              autoFocus
              className="mb-3 w-full rounded-card border border-surface px-3 py-2 text-sm"
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
                className="flex-1 rounded-card border border-surface py-2 text-sm font-semibold text-navy hover:bg-surface"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={pending || !reason.trim()}
                className="flex-1 rounded-card bg-danger py-2 text-sm font-bold text-white hover:bg-danger/90 disabled:opacity-40"
              >
                {pending ? "Voiding…" : `Void ${paymentNo}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function RestorePaymentButton({
  paymentId,
  paymentNo,
}: {
  paymentId: string;
  paymentNo: string;
}) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (
      !window.confirm(
        `Restore ${paymentNo}? It will count toward the balance again.`
      )
    )
      return;
    startTransition(async () => {
      const res = await unvoidPayment(paymentId);
      if (res.error) alert("Could not restore payment: " + res.error);
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="rounded-card border border-teal px-2 py-1 text-xs font-semibold text-teal-dark hover:bg-surface disabled:opacity-50"
    >
      {pending ? "…" : "Restore"}
    </button>
  );
}
