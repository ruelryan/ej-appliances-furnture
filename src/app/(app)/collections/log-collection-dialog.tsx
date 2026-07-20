"use client";

import { useEffect, useState, useTransition } from "react";
import { logCollection } from "./actions";
import { input, label } from "@/components/ui";

const DISPOSITIONS = [
  { key: "collected", label: "Collected" },
  { key: "promised", label: "Promised to pay" },
  { key: "not_available", label: "Not available" },
  { key: "refused", label: "Refused" },
] as const;

// Collector logs a collection or a visit outcome. Only a "Collected" entry
// carries an amount/method; the owner or admin posts it into a real payment.
export function LogCollectionDialog({
  contractId,
  customerName,
}: {
  contractId: string;
  customerName: string;
}) {
  const [open, setOpen] = useState(false);
  const [disposition, setDisposition] = useState<string>("collected");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function reset() {
    setDisposition("collected");
    setAmount("");
    setMethod("cash");
    setReference("");
    setNote("");
    setError("");
  }

  const collected = disposition === "collected";

  function submit() {
    setError("");
    startTransition(async () => {
      const res = await logCollection({
        contractId,
        amount: collected ? Number(amount) : 0,
        method: collected ? method : null,
        reference: collected && method === "online" ? reference.trim() : "",
        disposition,
        note: note.trim(),
      });
      if (res.error) setError(res.error);
      else {
        setOpen(false);
        reset();
      }
    });
  }

  const disabled =
    pending ||
    (collected &&
      (!(Number(amount) > 0) ||
        (method === "online" && !reference.trim())));

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="rounded-card bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark"
      >
        Log
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
              Log collection
            </h3>
            <p className="mb-3 truncate text-xs text-muted">{customerName}</p>

            <label className={label}>Outcome</label>
            <div className="mb-3 grid grid-cols-2 gap-2">
              {DISPOSITIONS.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => setDisposition(d.key)}
                  className={`rounded-card border px-2 py-2 text-xs font-semibold ${
                    disposition === d.key
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-line bg-white text-ink hover:bg-surface"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>

            {collected && (
              <>
                <label className={label}>Amount</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  autoFocus
                  className={`${input} mb-3`}
                />

                <label className={label}>Method</label>
                <div className="mb-3 grid grid-cols-2 gap-2">
                  {["cash", "online"].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMethod(m)}
                      className={`rounded-card border px-2 py-2 text-xs font-semibold capitalize ${
                        method === m
                          ? "border-brand bg-brand/10 text-brand"
                          : "border-line bg-white text-ink hover:bg-surface"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>

                {method === "online" && (
                  <>
                    <label className={label}>Reference no. (required)</label>
                    <input
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="GCash / online confirmation ref"
                      className={`${input} mb-3`}
                    />
                  </>
                )}
              </>
            )}

            <label className={label}>Note (optional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. will pay Friday"
              className={`${input} mb-3`}
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
                disabled={disabled}
                className="flex-1 rounded-card bg-brand py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
              >
                {pending ? "Saving…" : "Save entry"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
