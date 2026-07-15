"use client";

import { useTransition } from "react";
import { setUserActive } from "./actions";

export function ToggleActiveButton({
  userId,
  active,
}: {
  userId: string;
  active: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (
          active &&
          !window.confirm("Deactivate this user? They will lose access immediately.")
        )
          return;
        startTransition(() => setUserActive(userId, !active));
      }}
      className={`rounded-lg border px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${
        active
          ? "border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
          : "border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950"
      }`}
    >
      {pending ? "…" : active ? "Deactivate" : "Reactivate"}
    </button>
  );
}
