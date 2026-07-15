"use client";

import { useState, useTransition } from "react";
import { updateStatus } from "../actions";
import { COLLECTION_STATUSES, DELIVERY_STATUSES } from "@/lib/messages";

export function StatusForm({
  contractId,
  collectionStatus,
  deliveryStatus,
}: {
  contractId: string;
  collectionStatus: string | null;
  deliveryStatus: string;
}) {
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          await updateStatus(contractId, fd);
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        })
      }
      className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="min-w-40 flex-1">
        <label className="mb-1 block text-xs font-medium text-slate-500">
          Collection status
        </label>
        <select
          name="collection_status"
          defaultValue={collectionStatus ?? ""}
          className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        >
          <option value="">— none —</option>
          {COLLECTION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-40 flex-1">
        <label className="mb-1 block text-xs font-medium text-slate-500">
          Delivery status
        </label>
        <select
          name="delivery_status"
          defaultValue={deliveryStatus}
          className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        >
          {DELIVERY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-sky-800 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
      >
        {saved ? "✅ Saved" : pending ? "Saving…" : "Update status"}
      </button>
    </form>
  );
}
