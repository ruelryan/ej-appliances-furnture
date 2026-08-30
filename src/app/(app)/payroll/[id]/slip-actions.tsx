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
  periodEnd,
  todayISO,
}: {
  slipId: string;
  status: "draft" | "final";
  /** The slip period end, YYYY-MM-DD. */
  periodEnd?: string;
  /** Asia/Manila today, from phTodayISO(). */
  todayISO?: string;
}) {
  const router = useRouter();
  // 0034 lets a period be paid before it closes. That is usually exact -- the
  // last duty often falls days before the month end -- but it is a forecast,
  // so say plainly what it does not capture rather than reusing the generic
  // confirm.
  const inProgress = !!periodEnd && !!todayISO && periodEnd > todayISO;
  const finalizeMsg = inProgress
    ? [
        `This period has not ended yet — it runs to ${periodEnd}.`,
        "",
        "Any hours worked between now and then will NOT be included. If that",
        "happens, reopen the payslip and refresh it from DTR before paying.",
        "",
        "Finalize anyway?",
      ].join("\n")
    : "Finalize this payslip? The employee will be able to see it.";
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
                  finalizeMsg
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
