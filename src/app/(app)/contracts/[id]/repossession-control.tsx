"use client";

import { useState, useTransition } from "react";
import { SectionCard } from "@/components/section-card";
import { btnSecondary } from "@/components/ui";
import { setRepossessionStage } from "../actions";

// The one manual status left on a contract, and owner-only. Repossession is an
// owner decision under the Recto Law, and taking the item back cancels the
// sale — so this is set by hand, not auto-advanced by printing the demand letter.
const STAGES: { key: string; label: string; hint: string }[] = [
  { key: "none", label: "Not in repossession", hint: "Normal collection" },
  { key: "letter_prepared", label: "Demand letter prepared", hint: "Ready to serve" },
  { key: "letter_sent", label: "Demand letter served", hint: "Deadline running" },
  { key: "for_pullout", label: "Item for pull-out", hint: "Deadline passed" },
  { key: "repossessed", label: "Repossessed", hint: "Item recovered — sale cancelled" },
];

export function RepossessionControl({
  contractId,
  stage,
}: {
  contractId: string;
  stage: string;
}) {
  const [current, setCurrent] = useState(stage);
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  function set(next: string) {
    if (next === current) return;
    setError("");
    startTransition(async () => {
      const res = await setRepossessionStage(contractId, next);
      if (res.error) setError(res.error);
      else setCurrent(next);
    });
  }

  return (
    <SectionCard
      title="Repossession"
      sub="Owner only. Recovering the item cancels the sale — under the Recto Law you cannot then also pursue the balance."
    >
      {error && (
        <p className="mb-2 rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">{error}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {STAGES.map((s) => (
          <button
            key={s.key}
            type="button"
            disabled={busy}
            onClick={() => set(s.key)}
            title={s.hint}
            className={
              s.key === current
                ? "rounded-card bg-brand px-3 py-1.5 text-xs font-semibold text-white"
                : `${btnSecondary} text-xs`
            }
          >
            {s.label}
          </button>
        ))}
      </div>
      {current !== "none" && (
        <p className="mt-2 text-xs text-muted">
          {STAGES.find((s) => s.key === current)?.hint}
        </p>
      )}
    </SectionCard>
  );
}
