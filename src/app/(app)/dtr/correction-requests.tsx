"use client";

import { useState, useTransition } from "react";
import { cancelTimeCorrection, resolveTimeCorrection } from "./actions";
import { fmtDateShort, fmtTime } from "@/lib/format";

export type CorrectionRequest = {
  id: string;
  profile_id: string;
  work_date: string;
  requested_time_in: string;
  requested_time_out: string | null;
  reason: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  employee_name?: string;
};

// Owner: approve/reject a pending request.
export function ResolveRequestButtons({ requestId }: { requestId: string }) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function resolve(approve: boolean) {
    setError("");
    startTransition(async () => {
      const res = await resolveTimeCorrection(requestId, approve);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => resolve(true)}
          disabled={pending}
          className="rounded-card bg-positive px-3 py-1.5 text-xs font-semibold text-white hover:bg-positive-dark disabled:opacity-50"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => resolve(false)}
          disabled={pending}
          className="rounded-card border border-danger/40 px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger-bg disabled:opacity-50"
        >
          Reject
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

// Staff: withdraw their own pending request.
export function CancelRequestButton({ requestId }: { requestId: string }) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!window.confirm("Withdraw this correction request?")) return;
    startTransition(async () => {
      const res = await cancelTimeCorrection(requestId);
      if (res.error) alert("Could not withdraw request: " + res.error);
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="rounded-card border border-line px-2 py-1 text-xs font-semibold text-muted hover:bg-surface hover:text-ink disabled:opacity-50"
    >
      {pending ? "…" : "Withdraw"}
    </button>
  );
}

export function RequestSummary({ req }: { req: CorrectionRequest }) {
  return (
    <div className="min-w-0">
      <div className="text-sm font-semibold text-ink">
        {req.employee_name ? `${req.employee_name} · ` : ""}
        {fmtDateShort(req.work_date)}
      </div>
      <div className="text-xs text-muted">
        {fmtTime(req.requested_time_in)}
        {" – "}
        {req.requested_time_out ? fmtTime(req.requested_time_out) : "(no out)"}
        {" · "}
        {req.reason}
      </div>
    </div>
  );
}
