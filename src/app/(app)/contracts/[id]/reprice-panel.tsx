"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { peso } from "@/lib/format";
import { termLabel } from "@/lib/amortization";
import { btnPrimary, btnSecondary, input, label } from "@/components/ui";
import { proposeReprice, confirmReprice, revertReprice } from "../actions";

export interface Repricing {
  id: string;
  amendment_no: string;
  from_term: number;
  from_total: number;
  from_monthly: number;
  to_term: number;
  to_total: number;
  to_monthly: number;
  reason: string | null;
  status: string;
  signed_date: string | null;
}

// The Good-as-Cash discount lapses on an objective event — the term elapsed with
// a balance still outstanding. The button only offers the next rung of the
// ladder, and the SQL re-checks eligibility, so the UI cannot widen the rule.
export function RepricePanel({
  contractId,
  currentTerm,
  eligible,
  pending,
  history,
}: {
  contractId: string;
  currentTerm: number;
  eligible: boolean;
  pending: Repricing | null;
  history: Repricing[];
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [signedDate, setSignedDate] = useState("");
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  const nextTerm = currentTerm === 4 || currentTerm === 5 ? 6 : currentTerm === 6 ? 12 : null;
  const signed = history.filter((h) => h.status === "signed");

  function propose() {
    setError("");
    startTransition(async () => {
      const res = await proposeReprice(contractId, nextTerm!, reason.trim());
      if (res.error) setError(res.error);
      else {
        setOpen(false);
        setReason("");
      }
    });
  }

  function confirm(id: string) {
    setError("");
    startTransition(async () => {
      const res = await confirmReprice(id, signedDate || null);
      if (res.error) setError(res.error);
    });
  }

  function revert() {
    setError("");
    startTransition(async () => {
      const res = await revertReprice(contractId, "Settled at the original price");
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">{error}</p>
      )}

      {pending && (
        <div className="rounded-card border border-brand bg-brand/5 p-3">
          <p className="text-sm font-semibold text-ink">
            Amendment {pending.amendment_no} awaiting signature
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {termLabel(pending.from_term)} {peso(pending.from_total)} →{" "}
            {termLabel(pending.to_term)} {peso(pending.to_total)}. The contract is
            unchanged until the customer signs.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <Link href={`/print/amendment/${pending.id}`} className={btnSecondary}>
              Print amendment
            </Link>
            <div>
              <label className={`${label} text-xs`} htmlFor="signed_date">
                Date signed
              </label>
              <input
                id="signed_date"
                type="date"
                value={signedDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setSignedDate(e.target.value)}
                className={`${input} py-1.5 text-sm`}
              />
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => confirm(pending.id)}
              className={btnPrimary}
            >
              {busy ? "Saving…" : "Mark signed & apply"}
            </button>
          </div>
        </div>
      )}

      {!pending && eligible && nextTerm && !open && (
        <button type="button" onClick={() => setOpen(true)} className={btnSecondary}>
          Propose {termLabel(nextTerm)} amendment
        </button>
      )}

      {!pending && open && nextTerm && (
        <div className="rounded-card border border-line p-3">
          <label className={label} htmlFor="reason">
            Reason (appears on the amendment)
          </label>
          <input
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. term elapsed, balance outstanding after collection visits"
            className={input}
          />
          <p className="mt-1 text-xs text-muted">
            This creates an amendment to print and have the customer sign. Nothing
            changes on the contract until you mark it signed.
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy} onClick={propose} className={btnPrimary}>
              {busy ? "Creating…" : "Create amendment"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={btnSecondary}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {!pending && !eligible && !signed.length && (
        <p className="text-xs text-muted">
          Repricing becomes available once the term has elapsed and a balance is
          still outstanding.
        </p>
      )}

      {signed.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold text-ink">Amendment history</p>
          <ul className="space-y-1 text-xs text-muted">
            {history.map((h) => (
              <li key={h.id}>
                <span className="font-mono">{h.amendment_no}</span> ·{" "}
                {termLabel(h.from_term)} → {termLabel(h.to_term)} ·{" "}
                {peso(h.from_total)} → {peso(h.to_total)} ·{" "}
                <span className={h.status === "signed" ? "text-positive" : ""}>
                  {h.status}
                </span>
                {h.signed_date ? ` ${h.signed_date}` : ""}
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy}
            onClick={revert}
            className={`${btnSecondary} mt-2`}
          >
            Revert to original price
          </button>
          <p className="mt-1 text-xs text-muted">
            Use when the customer settles at the original contract price — the
            increase is waived.
          </p>
        </div>
      )}
    </div>
  );
}
