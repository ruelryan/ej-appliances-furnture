"use client";

import { useState, useTransition } from "react";
import { setHourlyRate } from "../actions";

export function RateForm({
  profileId,
  currentRate,
}: {
  profileId: string;
  currentRate: string | number | null;
}) {
  const [value, setValue] = useState(
    currentRate == null ? "" : String(Number(currentRate))
  );
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function save() {
    setError("");
    startTransition(async () => {
      const res = await setHourlyRate(profileId, Number(value));
      if (res.error) setError(res.error);
    });
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">
            ₱
          </span>
          <input
            type="number"
            inputMode="decimal"
            min="1"
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0.00"
            className="w-32 rounded-card border border-line py-2 pl-7 pr-3 text-base tabular-nums"
          />
        </div>
        <span className="text-xs text-muted">/ hour</span>
        <button
          type="button"
          onClick={save}
          disabled={pending || !value || Number(value) <= 0}
          className="rounded-card bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
        >
          {pending ? "…" : "Save"}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
