"use client";

import { useRef, useTransition } from "react";
import { addNote } from "../actions";

export function NoteForm({ contractId }: { contractId: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      ref={ref}
      action={(fd) =>
        startTransition(async () => {
          await addNote(contractId, fd);
          ref.current?.reset();
        })
      }
      className="mt-3 flex gap-2"
    >
      <input
        name="body"
        placeholder="Add a note…"
        required
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
      />
      <button
        type="submit"
        disabled={pending}
        className="shrink-0 rounded-lg bg-sky-800 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
      >
        {pending ? "…" : "Add"}
      </button>
    </form>
  );
}
