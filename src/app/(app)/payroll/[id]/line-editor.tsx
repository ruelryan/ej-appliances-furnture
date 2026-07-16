"use client";

import { useState, useTransition } from "react";
import { updatePayslipLines } from "../actions";
import type { PayslipLine } from "../types";

function LineList({
  title,
  lines,
  setLines,
  placeholder,
}: {
  title: string;
  lines: PayslipLine[];
  setLines: (l: PayslipLine[]) => void;
  placeholder: string;
}) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");

  return (
    <div>
      <div className="mb-1 text-xs font-medium text-ink">{title}</div>
      {lines.map((l, i) => (
        <div key={i} className="mb-1 flex items-center gap-2 text-sm">
          <span className="flex-1 truncate text-ink">{l.label}</span>
          <span className="tabular-nums text-ink">
            ₱{Number(l.amount).toFixed(2)}
          </span>
          <button
            type="button"
            onClick={() => setLines(lines.filter((_, j) => j !== i))}
            className="rounded-card border border-line px-2 py-0.5 text-xs font-semibold text-muted hover:bg-surface hover:text-danger"
            aria-label={`Remove ${l.label}`}
          >
            ×
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-card border border-line px-3 py-2 text-base"
        />
        <input
          type="number"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-28 rounded-card border border-line px-3 py-2 text-base tabular-nums"
        />
        <button
          type="button"
          onClick={() => {
            if (!label.trim() || !amount || Number(amount) <= 0) return;
            setLines([
              ...lines,
              { label: label.trim(), amount: Number(Number(amount).toFixed(2)) },
            ]);
            setLabel("");
            setAmount("");
          }}
          disabled={!label.trim() || !amount || Number(amount) <= 0}
          className="rounded-card border border-line px-3 py-2 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}

export function LineEditor({
  slipId,
  extraIncome,
  extraDeductions,
}: {
  slipId: string;
  extraIncome: PayslipLine[];
  extraDeductions: PayslipLine[];
}) {
  const [income, setIncome] = useState<PayslipLine[]>(extraIncome);
  const [deductions, setDeductions] = useState<PayslipLine[]>(extraDeductions);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const dirty =
    JSON.stringify(income) !== JSON.stringify(extraIncome) ||
    JSON.stringify(deductions) !== JSON.stringify(extraDeductions);

  function save() {
    setError("");
    startTransition(async () => {
      const res = await updatePayslipLines(slipId, income, deductions);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="space-y-3">
      <LineList
        title="Extra income"
        lines={income}
        setLines={setIncome}
        placeholder="e.g. Out-of-office duty"
      />
      <LineList
        title="Extra deductions"
        lines={deductions}
        setLines={setDeductions}
        placeholder="e.g. Cash advance"
      />
      {error && (
        <p className="rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={save}
        disabled={pending || !dirty}
        className="rounded-card bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
      >
        {pending ? "Saving…" : "Save lines"}
      </button>
    </div>
  );
}
