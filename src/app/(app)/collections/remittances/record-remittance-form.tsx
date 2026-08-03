"use client";

import { useState, useTransition } from "react";
import { peso } from "@/lib/format";
import { btnPrimary, btnSecondary, input, label } from "@/components/ui";
import { recordRemittance } from "./actions";

// Owner/admin records cash a collector handed in. Pre-filled with the running
// balance, but freely editable — a partial hand-over is normal, and entries
// logged late mean the balance is a guide, not a limit.
export function RecordRemittanceForm({
  collectorId,
  name,
  onHand,
}: {
  collectorId: string;
  name: string;
  onHand: number;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(onHand > 0 ? onHand.toFixed(2) : "");
  const [remittedOn, setRemittedOn] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function save() {
    setError("");
    const a = Number(amount);
    if (!(a > 0)) return setError("Amount must be greater than zero.");
    startTransition(async () => {
      const res = await recordRemittance({
        collectorId,
        amount: a,
        remittedOn: remittedOn || null,
        note,
      });
      if (res.error) setError(res.error);
      else {
        setOpen(false);
        setNote("");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setAmount(onHand > 0 ? onHand.toFixed(2) : "");
          setError("");
          setOpen(true);
        }}
        className={btnSecondary}
      >
        Record remittance
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-sm rounded-card bg-white p-5 text-left shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-base font-semibold text-ink">
          Record remittance
        </h3>
        <p className="mb-3 text-xs text-muted">
          {name} · cash on hand {peso(onHand)}
        </p>

        <label className={label} htmlFor="rmt_amt">
          Amount received
        </label>
        <input
          id="rmt_amt"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={`${input} mb-3`}
          autoFocus
        />

        <label className={label} htmlFor="rmt_on">
          Date received
        </label>
        <input
          id="rmt_on"
          type="date"
          value={remittedOn}
          onChange={(e) => setRemittedOn(e.target.value)}
          className={`${input} mb-1`}
        />
        <p className="mb-3 text-xs text-muted">Leave blank for today.</p>

        <label className={label} htmlFor="rmt_note">
          Note (optional)
        </label>
        <input
          id="rmt_note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. covers Mon–Wed collections"
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
            className={`flex-1 ${btnSecondary}`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className={`flex-1 ${btnPrimary}`}
          >
            {pending ? "Saving…" : "Record"}
          </button>
        </div>
      </div>
    </div>
  );
}
