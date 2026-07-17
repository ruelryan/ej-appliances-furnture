"use client";

import { useEffect, useState, useTransition } from "react";
import { SectionCard } from "@/components/section-card";
import { peso, fmtDateShort } from "@/lib/format";
import { input, label } from "@/components/ui";
import { setContractAgent } from "../actions";
import {
  markCommissionPaid,
  unmarkCommissionPaid,
  voidCommission,
} from "@/app/(app)/commissions/actions";

type Agent = { id: string; full_name: string };

export type CommissionRow = {
  id: string;
  commission_no: string;
  agent_id: string | null;
  agent_name: string | null;
  commission_amount: number | string;
  status: "pending" | "earned" | "paid" | "voided";
  dp_paid_date: string | null;
  paid_at: string | null;
  paid_reference: string | null;
};

const STATUS_STYLE: Record<string, string> = {
  pending: "border border-line bg-white text-muted",
  earned: "bg-warning-bg text-warning",
  paid: "bg-positive/10 text-positive",
  voided: "bg-danger-bg text-danger",
};

export function AgentCommissionPanel({
  contractId,
  commission,
  agents,
  agentId,
  canManage,
  isOwner,
  fallbackAgentName,
}: {
  contractId: string;
  commission: CommissionRow | null;
  agents: Agent[];
  agentId: string | null;
  canManage: boolean;
  isOwner: boolean;
  fallbackAgentName: string | null;
}) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [pick, setPick] = useState(agentId ?? "");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!assignOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAssignOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [assignOpen]);

  function run(fn: () => Promise<{ error?: string } | void>) {
    setError("");
    start(async () => {
      const res = await fn();
      if (res && "error" in res && res.error) setError(res.error);
      else setAssignOpen(false);
    });
  }

  const status = commission?.status;
  const agentName = commission?.agent_name ?? fallbackAgentName ?? "—";

  return (
    <SectionCard
      title="Agent & commission"
      action={
        canManage ? (
          <button
            type="button"
            onClick={() => {
              setPick(agentId ?? "");
              setError("");
              setAssignOpen(true);
            }}
            className="rounded-card border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface"
          >
            {agentId ? "Change agent" : "Set agent"}
          </button>
        ) : undefined
      }
    >
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Agent</dt>
          <dd className="text-right text-ink">{agentName}</dd>
        </div>
        {commission ? (
          <>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Commission (10%)</dt>
              <dd className="text-right font-semibold text-ink">
                {peso(commission.commission_amount)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">Status</dt>
              <dd>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    STATUS_STYLE[commission.status]
                  }`}
                >
                  {commission.status.toUpperCase()}
                </span>
              </dd>
            </div>
            {commission.dp_paid_date && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Downpayment paid</dt>
                <dd className="text-right text-ink">
                  {fmtDateShort(commission.dp_paid_date)}
                </dd>
              </div>
            )}
            {commission.paid_at && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Paid out</dt>
                <dd className="text-right text-ink">
                  {fmtDateShort(commission.paid_at)}
                  {commission.paid_reference ? ` · ${commission.paid_reference}` : ""}
                </dd>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-muted">
            No commission — assign a registered sales agent to start one.
          </p>
        )}
      </dl>

      {error && (
        <p className="mt-3 rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {canManage && commission && (
        <div className="mt-3 flex flex-wrap gap-2">
          {status === "earned" && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const ref = window.prompt("Payout reference (e.g. GCash ref):") ?? "";
                run(() => markCommissionPaid(commission.id, ref, contractId));
              }}
              className="rounded-card bg-positive px-3 py-1.5 text-xs font-semibold text-white hover:bg-positive-dark disabled:opacity-40"
            >
              Mark paid
            </button>
          )}
          {isOwner && status === "paid" && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm("Reverse this payout?"))
                  run(() => unmarkCommissionPaid(commission.id, contractId));
              }}
              className="rounded-card border border-line px-3 py-1.5 text-xs font-semibold text-muted hover:bg-surface disabled:opacity-40"
            >
              Reverse payout
            </button>
          )}
          {isOwner && (status === "pending" || status === "earned") && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const reason = window.prompt("Void this commission? Optional reason:");
                if (reason !== null)
                  run(() => voidCommission(commission.id, reason, contractId));
              }}
              className="rounded-card border border-line px-3 py-1.5 text-xs font-semibold text-muted hover:bg-surface hover:text-danger disabled:opacity-40"
            >
              Void
            </button>
          )}
        </div>
      )}

      {assignOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setAssignOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-card bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-base font-semibold text-ink">
              Set sales agent
            </h3>
            <label className={label}>Agent</label>
            <select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className={`${input} mb-3`}
            >
              <option value="">— None / walk-in —</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.full_name}
                </option>
              ))}
            </select>
            <p className="mb-3 text-xs text-muted">
              Assigning an agent starts a 10% commission on this contract&apos;s
              cash price, payable once the downpayment is fully paid.
            </p>
            {error && (
              <p className="mb-3 rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAssignOpen(false)}
                className="flex-1 rounded-card border border-line py-2 text-sm font-semibold text-ink hover:bg-surface"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => setContractAgent(contractId, pick || null))}
                className="flex-1 rounded-card bg-brand py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
