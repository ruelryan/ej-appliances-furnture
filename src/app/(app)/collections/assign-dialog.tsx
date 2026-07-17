"use client";

import { useEffect, useState, useTransition } from "react";
import { assignCollector } from "./actions";
import { input, label } from "@/components/ui";

type Collector = { id: string; full_name: string };

// Owner/admin assigns (or reassigns/unassigns) a collector + priority to a
// contract. Priority 1 = highest; blank = unranked.
export function AssignDialog({
  contractId,
  collectors,
  currentCollectorId,
  currentPriority,
  trigger,
}: {
  contractId: string;
  collectors: Collector[];
  currentCollectorId: string | null;
  currentPriority: number | null;
  trigger?: string;
}) {
  const [open, setOpen] = useState(false);
  const [collectorId, setCollectorId] = useState(currentCollectorId ?? "");
  const [priority, setPriority] = useState(
    currentPriority != null ? String(currentPriority) : ""
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
      const res = await assignCollector({
        contractId,
        collectorId: collectorId || null,
        priority: priority.trim() ? Number(priority) : null,
      });
      if (res.error) setError(res.error);
      else setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setCollectorId(currentCollectorId ?? "");
          setPriority(currentPriority != null ? String(currentPriority) : "");
          setError("");
          setOpen(true);
        }}
        className="rounded-card border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface"
      >
        {trigger ?? "Assign"}
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
            <h3 className="mb-3 text-base font-semibold text-ink">
              Assign collector
            </h3>

            <label className={label}>Collector</label>
            <select
              value={collectorId}
              onChange={(e) => setCollectorId(e.target.value)}
              className={`${input} mb-3`}
            >
              <option value="">— Unassigned —</option>
              {collectors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </select>

            <label className={label}>Priority (1 = highest, blank = none)</label>
            <input
              type="number"
              min="1"
              max="9"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              placeholder="e.g. 1"
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
                disabled={pending}
                className="flex-1 rounded-card bg-brand py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
