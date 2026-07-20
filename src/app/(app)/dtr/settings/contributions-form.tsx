"use client";

import { useState, useTransition } from "react";
import { setContributions } from "../actions";

const FIELDS = [
  { key: "philhealthEe", label: "PhilHealth EE" },
  { key: "philhealthEr", label: "PhilHealth ER" },
  { key: "sssEe", label: "SSS EE" },
  { key: "sssEr", label: "SSS ER" },
  { key: "pagibigEe", label: "Pag-IBIG EE" },
  { key: "pagibigEr", label: "Pag-IBIG ER" },
] as const;

type Amounts = Record<(typeof FIELDS)[number]["key"], string>;

export function ContributionsForm({
  profileId,
  current,
}: {
  profileId: string;
  current: Amounts;
}) {
  const [values, setValues] = useState<Amounts>(current);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    setError("");
    setSaved(false);
    startTransition(async () => {
      const res = await setContributions(profileId, {
        philhealthEe: Number(values.philhealthEe) || 0,
        philhealthEr: Number(values.philhealthEr) || 0,
        sssEe: Number(values.sssEe) || 0,
        sssEr: Number(values.sssEr) || 0,
        pagibigEe: Number(values.pagibigEe) || 0,
        pagibigEr: Number(values.pagibigEr) || 0,
      });
      if (res.error) setError(res.error);
      else setSaved(true);
    });
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="mb-1 block text-xs font-medium text-ink">
              {f.label}
            </label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={values[f.key]}
              onChange={(e) => {
                setSaved(false);
                setValues({ ...values, [f.key]: e.target.value });
              }}
              className="w-full rounded-card border border-line px-3 py-2 text-base tabular-nums"
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-card bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
        >
          {pending ? "…" : "Save contributions"}
        </button>
        {saved && <span className="text-xs text-positive-dark">Saved</span>}
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
