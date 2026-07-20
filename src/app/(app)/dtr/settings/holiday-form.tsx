"use client";

import { useRef, useState, useTransition } from "react";
import { addHoliday, deleteHoliday } from "../actions";
import { fmtDateShort } from "@/lib/format";

export function HolidayForm() {
  const ref = useRef<HTMLFormElement>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <form
      ref={ref}
      action={(fd) => {
        setError("");
        startTransition(async () => {
          const res = await addHoliday({
            date: String(fd.get("date") ?? ""),
            name: String(fd.get("name") ?? ""),
            type: fd.get("type") === "regular" ? "regular" : "special",
          });
          if (res.error) setError(res.error);
          else ref.current?.reset();
        });
      }}
      className="space-y-2"
    >
      <div className="flex flex-wrap gap-2">
        <input
          type="date"
          name="date"
          required
          className="rounded-card border border-line px-3 py-2 text-base"
        />
        <input
          name="name"
          required
          placeholder="e.g. Eid'l Fitr"
          className="min-w-40 flex-1 rounded-card border border-line px-3 py-2 text-base"
        />
        <select
          name="type"
          className="rounded-card border border-line bg-white px-3 py-2 text-base"
        >
          <option value="regular">Regular</option>
          <option value="special">Special (non-working)</option>
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-card bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
        >
          {pending ? "…" : "Add"}
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </form>
  );
}

export function DeleteHolidayButton({
  date,
  name,
}: {
  date: string;
  name: string;
}) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!window.confirm(`Remove "${name}" (${fmtDateShort(date)})?`)) return;
    startTransition(async () => {
      const res = await deleteHoliday(date);
      if (res.error) alert("Could not remove holiday: " + res.error);
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="rounded-card border border-danger/40 px-2 py-1 text-xs font-semibold text-danger hover:bg-danger-bg disabled:opacity-50"
    >
      {pending ? "…" : "Remove"}
    </button>
  );
}
