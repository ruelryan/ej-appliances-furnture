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
        className="w-full rounded-card border border-surface px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="shrink-0 rounded-card bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? "…" : "Add"}
      </button>
    </form>
  );
}
