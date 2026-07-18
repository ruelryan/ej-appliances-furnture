"use client";

import { useEffect, useState, useTransition } from "react";
import { setTaskStatus, reassignTask } from "../actions";
import { TEAM_OPTIONS } from "../new-task-dialog";
import { input, label } from "@/components/ui";

type Person = { id: string; full_name: string; role: string };

const STATUSES = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];

export function TaskActions({
  taskId,
  status,
  assigneeId,
  assigneeRole,
  people,
  canReassign,
}: {
  taskId: string;
  status: string;
  assigneeId: string | null;
  assigneeRole: string | null;
  people: Person[];
  canReassign: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"person" | "team">(assigneeId ? "person" : "team");
  const [pid, setPid] = useState(assigneeId ?? "");
  const [role, setRole] = useState(assigneeRole ?? "collector");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function run(fn: () => Promise<{ error?: string }>, close?: () => void) {
    setError("");
    start(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else close?.();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => (
          <button
            key={s.value}
            type="button"
            disabled={pending || s.value === status}
            onClick={() => run(() => setTaskStatus(taskId, s.value))}
            className={`rounded-card px-3 py-1.5 text-xs font-semibold disabled:opacity-60 ${
              s.value === status
                ? "bg-brand/10 text-brand"
                : "border border-line bg-white text-ink hover:bg-surface"
            }`}
          >
            {s.label}
          </button>
        ))}
        {canReassign && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-card border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface"
          >
            Reassign
          </button>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm rounded-card bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-base font-semibold text-ink">Reassign task</h3>
            <div className="mb-2 grid grid-cols-2 gap-2">
              {(["person", "team"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-card border px-3 py-2 text-sm font-semibold ${
                    mode === m ? "border-brand bg-brand/10 text-brand" : "border-line bg-white text-ink hover:bg-surface"
                  }`}
                >
                  {m === "person" ? "A person" : "A team"}
                </button>
              ))}
            </div>
            <label className={label}>{mode === "person" ? "Person" : "Team"}</label>
            {mode === "person" ? (
              <select value={pid} onChange={(e) => setPid(e.target.value)} className={`${input} mb-3`}>
                <option value="">— select person —</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name} ({p.role})
                  </option>
                ))}
              </select>
            ) : (
              <select value={role} onChange={(e) => setRole(e.target.value)} className={`${input} mb-3`}>
                {TEAM_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => setOpen(false)} className="flex-1 rounded-card border border-line py-2 text-sm font-semibold text-ink hover:bg-surface">
                Cancel
              </button>
              <button
                type="button"
                disabled={pending || (mode === "person" && !pid)}
                onClick={() =>
                  run(
                    () =>
                      reassignTask(
                        taskId,
                        mode === "person" ? pid : null,
                        mode === "team" ? role : null
                      ),
                    () => setOpen(false)
                  )
                }
                className="flex-1 rounded-card bg-brand py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
              >
                {pending ? "Saving…" : "Reassign"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
