"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import {
  requestCashAdvance,
  issueCashAdvance,
  approveCashAdvance,
  declineCashAdvance,
  addAdvanceExpense,
  closeCashAdvance,
} from "./actions";
import { input, label } from "@/components/ui";

type Collector = { id: string; full_name: string };

// ── Small modal shell (matches the app's other dialogs) ───────
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-card bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-base font-semibold text-ink">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function Actions({
  onClose,
  onSubmit,
  pending,
  submitLabel,
  disabled,
}: {
  onClose: () => void;
  onSubmit: () => void;
  pending: boolean;
  submitLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={onClose}
        className="flex-1 rounded-card border border-line py-2 text-sm font-semibold text-ink hover:bg-surface"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={pending || disabled}
        className="flex-1 rounded-card bg-brand py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </div>
  );
}

// ── Collector: request an advance ─────────────────────────────
export function RequestAdvanceButton() {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function submit() {
    setError("");
    start(async () => {
      const res = await requestCashAdvance({ amount: Number(amount), purpose });
      if (res.error) setError(res.error);
      else {
        setOpen(false);
        setAmount("");
        setPurpose("");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-card bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
      >
        Request advance
      </button>
      {open && (
        <Modal title="Request cash advance" onClose={() => setOpen(false)}>
          <label className={label}>Amount</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            autoFocus
            className={`${input} mb-3`}
          />
          <label className={label}>Purpose (optional)</label>
          <input
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="e.g. gasoline for route"
            className={`${input} mb-3`}
          />
          {error && (
            <p className="mb-3 rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}
          <Actions
            onClose={() => setOpen(false)}
            onSubmit={submit}
            pending={pending}
            submitLabel="Send request"
            disabled={!(Number(amount) > 0)}
          />
        </Modal>
      )}
    </>
  );
}

// ── Owner/admin: issue an advance directly ────────────────────
export function IssueAdvanceButton({ collectors }: { collectors: Collector[] }) {
  const [open, setOpen] = useState(false);
  const [collectorId, setCollectorId] = useState("");
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function submit() {
    setError("");
    start(async () => {
      const res = await issueCashAdvance({
        collectorId,
        amount: Number(amount),
        purpose,
      });
      if (res.error) setError(res.error);
      else {
        setOpen(false);
        setCollectorId("");
        setAmount("");
        setPurpose("");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-card border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-surface"
      >
        Issue advance
      </button>
      {open && (
        <Modal title="Issue cash advance" onClose={() => setOpen(false)}>
          <label className={label}>Collector</label>
          <select
            value={collectorId}
            onChange={(e) => setCollectorId(e.target.value)}
            className={`${input} mb-3`}
          >
            <option value="">— Select collector —</option>
            {collectors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
          <label className={label}>Amount</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className={`${input} mb-3`}
          />
          <label className={label}>Purpose (optional)</label>
          <input
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="e.g. gasoline"
            className={`${input} mb-3`}
          />
          {error && (
            <p className="mb-3 rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}
          <Actions
            onClose={() => setOpen(false)}
            onSubmit={submit}
            pending={pending}
            submitLabel="Issue"
            disabled={!collectorId || !(Number(amount) > 0)}
          />
        </Modal>
      )}
    </>
  );
}

// ── Collector/admin: add an expense receipt to an open advance ─
export function AddExpenseButton({ advanceId }: { advanceId: string }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [receiptRef, setReceiptRef] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function submit() {
    setError("");
    start(async () => {
      const res = await addAdvanceExpense({
        advanceId,
        description,
        amount: Number(amount),
        receiptRef,
      });
      if (res.error) setError(res.error);
      else {
        setOpen(false);
        setDescription("");
        setAmount("");
        setReceiptRef("");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-card border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface"
      >
        Add receipt
      </button>
      {open && (
        <Modal title="Add expense receipt" onClose={() => setOpen(false)}>
          <label className={label}>Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. gasoline — Shell Maasin"
            autoFocus
            className={`${input} mb-3`}
          />
          <label className={label}>Amount</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className={`${input} mb-3`}
          />
          <label className={label}>Receipt ref (optional)</label>
          <input
            value={receiptRef}
            onChange={(e) => setReceiptRef(e.target.value)}
            placeholder="OR / invoice no."
            className={`${input} mb-3`}
          />
          {error && (
            <p className="mb-3 rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}
          <Actions
            onClose={() => setOpen(false)}
            onSubmit={submit}
            pending={pending}
            submitLabel="Add"
            disabled={!description.trim() || !(Number(amount) > 0)}
          />
        </Modal>
      )}
    </>
  );
}

// ── Owner/admin: approve / decline a requested advance ────────
export function ApproveDeclineButtons({ advanceId }: { advanceId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  function approve() {
    setError("");
    start(async () => {
      const res = await approveCashAdvance(advanceId);
      if (res.error) setError(res.error);
    });
  }
  function decline() {
    const reason = window.prompt("Decline this request? Optional reason:");
    if (reason === null) return;
    setError("");
    start(async () => {
      const res = await declineCashAdvance(advanceId, reason);
      if (res.error) setError(res.error);
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={approve}
        disabled={pending}
        className="rounded-card bg-positive px-3 py-1.5 text-xs font-semibold text-white hover:bg-positive-dark disabled:opacity-40"
      >
        Approve
      </button>
      <button
        type="button"
        onClick={decline}
        disabled={pending}
        className="rounded-card border border-line px-3 py-1.5 text-xs font-semibold text-muted hover:bg-surface hover:text-danger disabled:opacity-40"
      >
        Decline
      </button>
      {error && <span className="text-[10px] text-danger">{error}</span>}
    </span>
  );
}

// ── Owner/admin: close an open advance ────────────────────────
export function CloseAdvanceButton({ advanceId }: { advanceId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  function close() {
    if (!window.confirm("Close this advance? Receipts should reconcile first."))
      return;
    setError("");
    start(async () => {
      const res = await closeCashAdvance(advanceId);
      if (res.error) setError(res.error);
    });
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={close}
        disabled={pending}
        className="rounded-card border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface disabled:opacity-40"
      >
        {pending ? "…" : "Close"}
      </button>
      {error && <span className="text-[10px] text-danger">{error}</span>}
    </span>
  );
}
