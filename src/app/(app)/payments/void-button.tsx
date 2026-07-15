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
        className="rounded-lg border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
      >
        Void
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-base font-bold text-red-700 dark:text-red-400">
              Void this payment?
            </h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              It will stop counting toward the balance. You can restore it
              later if this is a mistake.
            </p>

            <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                {customerName}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                <span className="font-mono">{paymentNo}</span> ·{" "}
                {fmtDateShort(paymentDate)}
              </div>
              <div className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">
                {peso(amount)}
              </div>
            </div>

            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
              Reason (required)
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. duplicate entry, wrong amount"
              autoFocus
              className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />

            {error && (
              <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={pending || !reason.trim()}
                className="flex-1 rounded-lg bg-red-700 py-2 text-sm font-bold text-white hover:bg-red-600 disabled:opacity-40"
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
      className="rounded-lg border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950"
    >
      {pending ? "…" : "Restore"}
    </button>
  );
}
