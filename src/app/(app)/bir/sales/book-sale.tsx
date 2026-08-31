"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/alert";
import { Dialog } from "@/components/dialog";
import {
  btnDanger,
  btnPrimary,
  btnPrimarySm,
  btnSecondary,
  btnSecondarySm,
  input,
  label,
  textarea,
} from "@/components/ui";
import { peso, fmtDateShort } from "@/lib/format";
import { branchInfo } from "@/lib/bir";
import { bookSale, cancelSaleEntry } from "../actions";

export interface RegisterRow {
  contract_id: string;
  contract_no: string;
  contract_date: string;
  customer_name: string;
  customer_address: string | null;
  item_description: string | null;
  item_type: string | null;
  cash_price: number;
  total_price: number;
  term_months: number;
  branch: string;
  booked: boolean;
  entry_id: string | null;
  invoice_no: string | null;
  sales_date: string | null;
  gross_snapshot: number | null;
}

/**
 * Enter one contract in the sales book.
 *
 * The invoice number is typed, never suggested. Each registration has its own
 * BIR-registered booklet, and a number the app invented would be a number the
 * BIR series does not know about — the same shape as the contract-number
 * collision that came out of the Sheet reconciliation.
 *
 * The amount is not editable either: it is `cash_price`, snapshotted by SQL at
 * booking. Letting someone retype it would be inviting a declared figure that
 * matches no contract.
 */
export function BookSale({ row, defaultDate }: { row: RegisterRow; defaultDate: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  const [invoiceNo, setInvoiceNo] = useState("");
  const [salesDate, setSalesDate] = useState(defaultDate);
  const [note, setNote] = useState("");

  const book = branchInfo(row.branch);

  function submit() {
    setError("");
    if (!invoiceNo.trim()) return setError("Type the invoice number from the booklet.");
    startTransition(async () => {
      const res = await bookSale({
        contractId: row.contract_id,
        invoiceNo,
        salesDate,
        note,
      });
      if (res.error) setError(res.error);
      else {
        setOpen(false);
        setInvoiceNo("");
        setNote("");
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
        className={btnPrimarySm}
      >
        Book
      </button>

      <Dialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Enter this sale in the book"
        subtitle={`${row.contract_no} · ${row.customer_name}`}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setOpen(false)}
              className={btnSecondary}
            >
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={submit} className={btnPrimary}>
              {busy ? "Saving…" : "Book this sale"}
            </button>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          {error && <Alert tone="danger">{error}</Alert>}

          <div className="rounded-card bg-surface px-3 py-2">
            <Row k="Book" v={`${book.label} — ${book.registeredName}`} />
            <Row k="TIN" v={book.tin} mono />
            <Row k="Item" v={row.item_description ?? "—"} />
            <Row k="Contract date" v={fmtDateShort(row.contract_date)} />
          </div>

          <div className="rounded-card bg-surface px-3 py-2">
            <Row k="Cash price (declared)" v={peso(row.cash_price)} strong />
            {Number(row.total_price) !== Number(row.cash_price) && (
              <Row
                k={`Term price (${row.term_months} mo)`}
                v={peso(row.total_price)}
                muted
              />
            )}
          </div>
          {Number(row.total_price) !== Number(row.cash_price) && (
            <p className="text-xs text-muted">
              Booked at the cash price, as agreed. The{" "}
              {peso(Number(row.total_price) - Number(row.cash_price))} financing
              charge on this term is not included.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Invoice no.</label>
              <input
                className={`${input} font-mono`}
                value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)}
                placeholder="From the booklet"
                autoFocus
              />
            </div>
            <div>
              <label className={label}>Date entered</label>
              <input
                type="date"
                className={input}
                value={salesDate}
                onChange={(e) => setSalesDate(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted">
            Type the number printed on the {book.label} booklet. The app does not
            assign it — it must match the paper.
          </p>

          <div>
            <label className={label}>Note (optional)</label>
            <textarea
              className={textarea}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}

/** Undo a booking. Cancels, never deletes — the row keeps its audit trail. */
export function CancelBooking({ row }: { row: RegisterRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  function submit() {
    setError("");
    if (!reason.trim()) return setError("A reason is required.");
    startTransition(async () => {
      const res = await cancelSaleEntry(row.entry_id!, reason);
      if (res.error) setError(res.error);
      else {
        setOpen(false);
        setReason("");
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
        className={btnSecondarySm}
      >
        Cancel entry
      </button>
      <Dialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Cancel this sales entry?"
        subtitle={`${row.contract_no} · invoice ${row.invoice_no ?? ""}`}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setOpen(false)}
              className={btnSecondary}
            >
              Keep it
            </button>
            <button type="button" disabled={busy} onClick={submit} className={btnDanger}>
              {busy ? "Saving…" : "Cancel entry"}
            </button>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          {error && <Alert tone="danger">{error}</Alert>}
          <Alert tone="warning" title="The sale returns to the not-yet-booked list.">
            The entry is kept, marked cancelled, with your reason and an audit
            record. It stops counting toward the period totals and the export,
            and the invoice number becomes free to use again.
          </Alert>
          <div>
            <label className={label}>Reason</label>
            <input
              className={input}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Wrong invoice number, entered twice…"
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}

function Row({
  k,
  v,
  mono,
  strong,
  muted,
}: {
  k: string;
  v: string;
  mono?: boolean;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-muted">{k}</span>
      <span
        className={`text-right ${mono ? "font-mono text-xs" : ""} ${
          strong ? "font-semibold tabular-nums" : ""
        } ${muted ? "text-muted tabular-nums" : "text-ink"}`}
      >
        {v}
      </span>
    </div>
  );
}
