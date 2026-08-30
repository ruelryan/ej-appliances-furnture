"use client";

import { useState, useTransition } from "react";
import { setHourlyRate, setMealAllowance, setSeparationDate } from "../actions";

export function RateForm({
  profileId,
  currentRate,
  currentMeal,
  currentSeparatedOn,
}: {
  profileId: string;
  currentRate: string | number | null;
  currentMeal?: string | number | null;
  /** Last day of employment, or null while still employed. */
  currentSeparatedOn?: string | null;
}) {
  const [value, setValue] = useState(
    currentRate == null ? "" : String(Number(currentRate))
  );
  const [meal, setMeal] = useState(
    currentMeal == null ? "" : String(Number(currentMeal))
  );
  const [separated, setSeparated] = useState(currentSeparatedOn ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function save() {
    setError("");
    startTransition(async () => {
      const res = await setHourlyRate(profileId, Number(value));
      if (res.error) return setError(res.error);
      // The allowance RPC requires the rate row to exist, so it always runs second.
      const m = await setMealAllowance(profileId, Number(meal) || 0);
      if (m.error) return setError(m.error);
      // Last, and only when it changed: it is the one field here that stops
      // pay accruing, so it should not ride along silently with a rate edit.
      if ((separated || null) !== (currentSeparatedOn ?? null)) {
        const sp = await setSeparationDate(profileId, separated || null);
        if (sp.error) setError(sp.error);
      }
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
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">
            ₱
          </span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={meal}
            onChange={(e) => setMeal(e.target.value)}
            placeholder="0.00"
            title="Meal allowance per day actually worked"
            className="w-28 rounded-card border border-line py-2 pl-7 pr-3 text-base tabular-nums"
          />
        </div>
        <span className="text-xs text-muted">meal / day</span>
        <input
          type="date"
          value={separated}
          onChange={(e) => setSeparated(e.target.value)}
          title="Last day of employment. Leave blank while still employed — once set, they stop earning holiday pay after this date."
          className="w-40 rounded-card border border-line px-3 py-2 text-base"
        />
        <span className="text-xs text-muted">last day</span>
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
