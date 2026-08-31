"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/alert";
import { Dialog } from "@/components/dialog";
import {
  btnDanger,
  btnPrimary,
  btnSecondary,
  btnSecondarySm,
  input,
  label,
  select,
  textarea,
} from "@/components/ui";
import { peso } from "@/lib/format";
import {
  BIR_BRANCHES,
  BIR_CATEGORIES,
  DOC_TYPES,
  birSplit,
  branchInfo,
  orCannotClaimInputTax,
} from "@/lib/bir";
import { recordBirExpense, updateBirExpense, voidBirExpense } from "../actions";

export interface ExpenseRow {
  id: string;
  expense_date: string;
  supplier_id: string | null;
  supplier_name_snapshot: string;
  doc_type: string;
  doc_no: string | null;
  gross_vat: number;
  gross_non_vat: number;
  vatable_purchases: number;
  vat_input_tax: number;
  total: number;
  category: string;
  branch: string;
  note: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

export interface SupplierOption {
  id: string;
  name: string;
  address: string | null;
  tin: string | null;
  vat_registered: boolean;
  bir_name: string | null;
}

/**
 * One dialog for adding and editing a purchase-journal row.
 *
 * The amount is entered ONCE, with a VAT switch beside it, rather than as the
 * two columns the sheet has. Every row in the sheet fills either the VAT column
 * or the non-VAT column and never both, so two fields would only offer a way to
 * get it wrong. The switch defaults from the supplier's `vat_registered` flag,
 * which is the fact that actually decides it.
 */
export function ExpenseManager({
  mode,
  row,
  suppliers,
  defaultDate,
}: {
  mode: "create" | "edit";
  row?: ExpenseRow;
  suppliers: SupplierOption[];
  defaultDate: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  const [date, setDate] = useState(row?.expense_date ?? defaultDate);
  const [supplierId, setSupplierId] = useState(row?.supplier_id ?? "");
  const [freeName, setFreeName] = useState(
    row && !row.supplier_id ? row.supplier_name_snapshot : ""
  );
  const [docType, setDocType] = useState(row?.doc_type ?? "sales_invoice");
  const [docNo, setDocNo] = useState(row?.doc_no ?? "");
  const [isVat, setIsVat] = useState(row ? Number(row.gross_vat) > 0 : true);
  const [amount, setAmount] = useState(
    row ? String(Number(row.gross_vat) > 0 ? row.gross_vat : row.gross_non_vat) : ""
  );
  const [category, setCategory] = useState(row?.category ?? "PURCHASES");
  const [branch, setBranch] = useState(row?.branch ?? "shared");
  const [note, setNote] = useState(row?.note ?? "");
  const [voidReason, setVoidReason] = useState("");

  const chosen = suppliers.find((s) => s.id === supplierId) ?? null;
  const gross = Number(amount) || 0;
  const preview = birSplit(isVat ? gross : 0);
  const orWarning = orCannotClaimInputTax(docType, date, isVat ? gross : 0);

  function pickSupplier(id: string) {
    setSupplierId(id);
    const s = suppliers.find((x) => x.id === id);
    // The supplier's registration is the fact that decides whether input tax
    // may be claimed at all, so follow it rather than leaving a stale switch.
    if (s) setIsVat(s.vat_registered);
  }

  function reset() {
    setError("");
    setConfirmVoid(false);
    setVoidReason("");
  }

  function save() {
    setError("");
    const name = chosen ? (chosen.bir_name ?? chosen.name) : freeName.trim();
    if (!name) return setError("Choose a supplier, or type a name for a one-off payee.");
    if (gross <= 0) return setError("Enter the amount on the document.");

    startTransition(async () => {
      const payload = {
        expenseDate: date,
        supplierId: supplierId || null,
        supplierName: name,
        docType,
        docNo,
        grossVat: isVat ? gross : 0,
        grossNonVat: isVat ? 0 : gross,
        category,
        branch,
        note,
      };
      const res =
        mode === "edit" && row
          ? await updateBirExpense(row.id, payload)
          : await recordBirExpense(payload);
      if (res.error) setError(res.error);
      else {
        setOpen(false);
        reset();
        router.refresh();
      }
    });
  }

  function doVoid() {
    if (!row) return;
    setError("");
    if (!voidReason.trim()) return setError("A reason is required to void.");
    startTransition(async () => {
      const res = await voidBirExpense(row.id, voidReason);
      if (res.error) setError(res.error);
      else {
        setOpen(false);
        reset();
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className={mode === "create" ? btnPrimary : btnSecondarySm}
      >
        {mode === "create" ? "Add expense" : "Edit"}
      </button>

      <Dialog
        open={open}
        onClose={() => !busy && (setOpen(false), reset())}
        title={mode === "create" ? "Add an expense" : "Edit expense"}
        subtitle={mode === "edit" ? row?.supplier_name_snapshot : undefined}
        footer={
          <div className="flex items-center justify-between gap-2">
            {mode === "edit" && !confirmVoid ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmVoid(true)}
                className={btnSecondary}
              >
                Void
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
                className={btnSecondary}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={confirmVoid ? doVoid : save}
                className={confirmVoid ? btnDanger : btnPrimary}
              >
                {busy ? "Saving…" : confirmVoid ? "Void this expense" : "Save"}
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-3">
          {error && <Alert tone="danger">{error}</Alert>}

          {confirmVoid ? (
            <>
              <Alert tone="warning" title="Voiding, not deleting.">
                The row stays in the journal struck through, with your reason and
                an audit entry. It stops counting toward the period totals and
                the export.
              </Alert>
              <div>
                <label className={label}>Reason</label>
                <input
                  className={input}
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="Duplicate entry, wrong amount, returned goods…"
                />
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>Date on the document</label>
                  <input
                    type="date"
                    className={input}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className={label}>Category</label>
                  <select
                    className={select}
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    {BIR_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className={label}>Which book</label>
                <select
                  className={select}
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                >
                  {BIR_BRANCHES.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted">
                  {branchInfo(branch).registeredName} — TIN{" "}
                  <span className="font-mono">{branchInfo(branch).tin}</span>
                  {branch === "shared" &&
                    ". Overhead that belongs to neither branch on its own; the split is the bookkeeper's call."}
                </p>
              </div>

              <div>
                <label className={label}>Supplier</label>
                <select
                  className={select}
                  value={supplierId}
                  onChange={(e) => pickSupplier(e.target.value)}
                >
                  <option value="">— one-off payee —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.vat_registered ? " (VAT)" : ""}
                    </option>
                  ))}
                </select>
                {!supplierId && (
                  <input
                    className={`${input} mt-2`}
                    value={freeName}
                    onChange={(e) => setFreeName(e.target.value)}
                    placeholder="Name of the payee"
                  />
                )}
                {chosen?.tin && (
                  <p className="mt-1 text-xs text-muted">
                    TIN <span className="font-mono">{chosen.tin}</span>
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>Document</label>
                  <select
                    className={select}
                    value={docType}
                    onChange={(e) => setDocType(e.target.value)}
                  >
                    {DOC_TYPES.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label}>Document no.</label>
                  <input
                    className={input}
                    value={docNo}
                    onChange={(e) => setDocNo(e.target.value)}
                    placeholder="Invoice / OR number"
                  />
                </div>
              </div>

              <div>
                <label className={label}>Amount on the document</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  className={input}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
                <label className="mt-2 flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={isVat}
                    onChange={(e) => setIsVat(e.target.checked)}
                    className="h-4 w-4"
                  />
                  VAT purchase — claim input tax
                </label>
              </div>

              {isVat && gross > 0 && (
                <div className="rounded-card bg-surface px-3 py-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted">Vatable purchases</span>
                    <span className="tabular-nums">{peso(preview.vatable)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Input tax (12%)</span>
                    <span className="tabular-nums">{peso(preview.inputTax)}</span>
                  </div>
                </div>
              )}

              {orWarning && (
                <Alert tone="warning" title="This document cannot support an input-tax claim.">
                  Since RR 7-2024 an official receipt dated after 31 Dec 2024 is
                  a supplementary document. Ask the supplier for a sales invoice,
                  or record this as a non-VAT purchase.
                </Alert>
              )}

              <div>
                <label className={label}>Note (optional)</label>
                <textarea
                  className={textarea}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}
