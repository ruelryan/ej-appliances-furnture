"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deletePayslip,
  finalizePayslip,
  refreshPayslip,
  reopenPayslip,
} from "../actions";
import { btnPositive, btnSecondary } from "@/components/ui";

export function SlipActions({
  slipId,
  status,
}: {
  slipId: string;
  status: "draft" | "final";
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ error?: string }>, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setError("");
    startTransition(async () => {
      const res = await action();
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {status === "draft" ? (
          <>
            <button
              type="button"
              onClick={() =>
                run(
                  () => finalizePayslip(slipId),
                  "Finalize this payslip? The employee will be able to see it."
                )
              }
              disabled={pending}
              className={btnPositive}
            >
              Finalize
            </button>
            <button
              type="button"
              onClick={() => run(() => refreshPayslip(slipId))}
              disabled={pending}
              className={btnSecondary}
              title="Re-pull hours and contribution amounts after corrections"
            >
              Refresh from DTR
            </button>
            <button
              type="button"
              onClick={() =>
                run(async () => {
                  const res = await deletePayslip(slipId);
                  if (!res.error) router.push("/payroll");
                  return res;
                }, "Delete this draft payslip?")
              }
              disabled={pending}
              className="rounded-card border border-danger/40 px-3 py-2 text-sm font-semibold text-danger hover:bg-danger-bg disabled:opacity-50"
            >
              Delete draft
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() =>
              run(
                () => reopenPayslip(slipId),
                "Reopen this payslip? It will be hidden from the employee until finalized again."
              )
            }
            disabled={pending}
            className={btnSecondary}
          >
            Reopen
          </button>
        )}
      </div>
      {error && (
        <p className="rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
