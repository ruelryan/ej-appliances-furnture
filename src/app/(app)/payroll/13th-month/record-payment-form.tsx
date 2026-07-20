"use client";

import { useState, useTransition } from "react";
import { peso } from "@/lib/format";
import { btnPrimary, btnSecondary, input, label } from "@/components/ui";
import { record13thMonthPayment } from "../actions";

export function RecordPaymentForm({
  profileId,
  name,
  year,
  suggested,
}: {
  profileId: string;
  name: string;
  year: number;
  suggested: number;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(suggested > 0 ? suggested.toFixed(2) : "");
  const [paidOn, setPaidOn] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function save() {
    setError("");
    const a = Number(amount);
    if (!(a > 0)) return setError("Amount must be greater than zero.");
    startTransition(async () => {
      const res = await record13thMonthPayment(profileId, year, a, paidOn || null, note);
      if (res.error) setError(res.error);
      else setOpen(false);
    });
  }

  if (suggested <= 0 && !open) {
    return <span className="text-xs text-muted">settled</span>;
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={btnSecondary}>
        Record payment
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
          13th-month payment
        </h3>
        <p className="mb-3 text-xs text-muted">
          {name} · {year} · balance {peso(suggested)}
        </p>

        <label className={label} htmlFor="amt">Amount</label>
        <input
          id="amt"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={`${input} mb-3`}
          autoFocus
        />

        <label className={label} htmlFor="paid_on">Date paid</label>
        <input
          id="paid_on"
          type="date"
          value={paidOn}
          onChange={(e) => setPaidOn(e.target.value)}
          className={`${input} mb-1`}
        />
        <p className="mb-3 text-xs text-muted">Leave blank for today.</p>

        <label className={label} htmlFor="note">Note (optional)</label>
        <input
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. paid in cash with December payslip"
          className={`${input} mb-3`}
        />

        {error && (
          <p className="mb-3 rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button type="button" onClick={() => setOpen(false)} className={`flex-1 ${btnSecondary}`}>
            Cancel
          </button>
          <button type="button" onClick={save} disabled={pending} className={`flex-1 ${btnPrimary}`}>
            {pending ? "Saving…" : "Record"}
          </button>
        </div>
      </div>
    </div>
  );
}
