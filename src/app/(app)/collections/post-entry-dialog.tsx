"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { postCollectionEntry } from "./actions";
import { input, label } from "@/components/ui";

const RECEIPT_TYPES = ["Appliances", "Furniture"];

// Owner/admin turns a collector's pending entry into a real payment, then
// jumps to the printable receipt.
export function PostEntryDialog({
  entryId,
  amountLabel,
  defaultReceiptType,
}: {
  entryId: string;
  amountLabel: string;
  defaultReceiptType?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [receiptNo, setReceiptNo] = useState("");
  const [receiptType, setReceiptType] = useState(
    defaultReceiptType && RECEIPT_TYPES.includes(defaultReceiptType)
      ? defaultReceiptType
      : "Appliances"
  );
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function submit() {
    setError("");
    startTransition(async () => {
      const res = await postCollectionEntry({
        entryId,
        receiptNo: receiptNo.trim(),
        receiptType,
      });
      if (res.error) setError(res.error);
      else if (res.paymentId) router.push(`/print/receipt/${res.paymentId}`);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError("");
          setReceiptNo("");
          setOpen(true);
        }}
        className="rounded-card bg-positive px-3 py-1.5 text-xs font-semibold text-white hover:bg-positive-dark"
      >
        Post payment
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
              Post payment — {amountLabel}
            </h3>
            <p className="mb-3 text-xs text-muted">
              This records the payment against the contract and opens the
              receipt to print or send.
            </p>

            <label className={label}>Official receipt / booklet no.</label>
            <input
              value={receiptNo}
              onChange={(e) => setReceiptNo(e.target.value)}
              placeholder="e.g. 00123"
              autoFocus
              className={`${input} mb-3`}
            />

            <label className={label}>Receipt type</label>
            <div className="mb-3 grid grid-cols-2 gap-2">
              {RECEIPT_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setReceiptType(t)}
                  className={`rounded-card border px-2 py-2 text-xs font-semibold ${
                    receiptType === t
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-line bg-white text-ink hover:bg-surface"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

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
                disabled={pending}
                className="flex-1 rounded-card bg-positive py-2 text-sm font-semibold text-white hover:bg-positive-dark disabled:opacity-40"
              >
                {pending ? "Posting…" : "Post & print"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
