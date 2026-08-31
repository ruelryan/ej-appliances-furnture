"use client";

import { useState, useTransition } from "react";
import { setUserRole } from "./actions";
import { input } from "@/components/ui";
import { ROLE_LABELS } from "./roles";

const OPTIONS = [
  "collector",
  "admin",
  "sales_agent",
  "delivery",
  "bookkeeper",
  "owner",
] as const;

export function RoleSelect({
  userId,
  role,
}: {
  userId: string;
  role: string;
}) {
  const [value, setValue] = useState(role);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <select
        value={OPTIONS.includes(value as (typeof OPTIONS)[number]) ? value : ""}
        disabled={pending}
        className={`${input} h-8 py-0 text-xs`}
        onChange={(e) => {
          const next = e.target.value;
          const prev = value;
          setValue(next);
          setError(null);
          startTransition(async () => {
            try {
              await setUserRole(userId, next);
            } catch (err) {
              setValue(prev);
              setError(err instanceof Error ? err.message : "Failed to update");
            }
          });
        }}
      >
        {/* Legacy 'staff' shows as a disabled placeholder until reassigned */}
        {!OPTIONS.includes(value as (typeof OPTIONS)[number]) && (
          <option value="" disabled>
            {ROLE_LABELS[value] ?? value}
          </option>
        )}
        {OPTIONS.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
      {error && <span className="text-micro text-danger">{error}</span>}
    </div>
  );
}
