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
      className={`rounded-card border px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${
        active
          ? "border-danger/40 text-danger hover:bg-danger-bg"
          : "border-positive text-positive-dark hover:bg-surface"
      }`}
    >
      {pending ? "…" : active ? "Deactivate" : "Reactivate"}
    </button>
  );
}
