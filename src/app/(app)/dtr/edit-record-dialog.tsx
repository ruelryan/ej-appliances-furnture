"use client";

import { useEffect, useState, useTransition } from "react";
import { deleteTimeRecord, upsertTimeRecord } from "./actions";

// Owner-only: correct a punch or add a forgotten day.
export function EditRecordDialog({
  profileId,
  workDate,
  dateLabel,
  recordId,
  timeIn,
  timeOut,
  note,
}: {
  profileId: string;
  workDate: string;
  dateLabel: string;
  recordId: string | null;
  timeIn: string | null;
  timeOut: string | null;
  note: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [inVal, setInVal] = useState(timeIn?.slice(0, 5) ?? "");
  const [outVal, setOutVal] = useState(timeOut?.slice(0, 5) ?? "");
  const [noteVal, setNoteVal] = useState(note ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function save() {
    startTransition(async () => {
      const res = await upsertTimeRecord({
        profileId,
        workDate,
        timeIn: inVal,
        timeOut: outVal,
        note: noteVal.trim(),
      });
      if (res.error) setError(res.error);
      else setOpen(false);
    });
  }

  function remove() {
    if (!recordId) return;
    if (!window.confirm(`Delete the time record for ${dateLabel}?`)) return;
    startTransition(async () => {
      const res = await deleteTimeRecord(recordId);
      if (res.error) setError(res.error);
      else setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError("");
          setInVal(timeIn?.slice(0, 5) ?? "");
          setOutVal(timeOut?.slice(0, 5) ?? "");
          setNoteVal(note ?? "");
          setOpen(true);
        }}
        className="rounded-card border border-line px-2 py-1 text-xs font-semibold text-muted hover:bg-surface hover:text-ink"
      >
        {recordId ? "Edit" : "Add"}
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
              {dateLabel}
            </h3>
            <p className="mb-3 text-xs text-muted">
              Corrections are saved to the audit log.
            </p>

            <div className="mb-3 grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink">
                  Time in
                </label>
                <input
                  type="time"
                  value={inVal}
                  onChange={(e) => setInVal(e.target.value)}
                  className="w-full rounded-card border border-line px-3 py-2.5 text-base"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink">
                  Time out
                </label>
                <input
                  type="time"
                  value={outVal}
                  onChange={(e) => setOutVal(e.target.value)}
                  className="w-full rounded-card border border-line px-3 py-2.5 text-base"
                />
              </div>
            </div>

            <label className="mb-1 block text-xs font-medium text-ink">
              Note
            </label>
            <input
              value={noteVal}
              onChange={(e) => setNoteVal(e.target.value)}
              placeholder="e.g. forgot to clock out"
              className="mb-3 w-full rounded-card border border-line px-3 py-2.5 text-base"
            />

            {error && (
              <p className="mb-3 rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">
                {error}
              </p>
            )}

            <div className="flex gap-2">
              {recordId && (
                <button
                  type="button"
                  onClick={remove}
                  disabled={pending}
                  className="rounded-card border border-danger/40 px-3 py-2 text-sm font-semibold text-danger hover:bg-danger-bg disabled:opacity-50"
                >
                  Delete
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 rounded-card border border-line py-2 text-sm font-semibold text-ink hover:bg-surface"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={pending || !inVal}
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
