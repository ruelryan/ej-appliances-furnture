"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BIR_SALE_TYPES, DEFAULT_SALE_TYPE, birSplit } from "@/lib/bir";
import { peso } from "@/lib/format";
import { Alert } from "@/components/alert";
import { Dialog } from "@/components/dialog";
import {
  btnPrimary,
  btnPrimarySm,
  btnSecondary,
  btnSecondarySm,
  input,
  label,
  select as selectClass,
} from "@/components/ui";
import { bookSale, updateSaleEntryDetails } from "../actions";

export interface BookableContract {
  contract_id: string;
  contract_no: string;
  customer_name: string;
  customer_address: string | null;
  item_description: string | null;
  cash_price: number;
}

/**
 * The live line at the bottom of the ledger — the app's version of writing the
 * next row into the book.
 *
 * Only three things are typed: the invoice number from the booklet, the type
 * of sale, and the quantity. Name, address and every amount fill themselves in
 * from the chosen contract and stay read-only, because `book_sale` derives
 * them in SQL at booking; a typed amount here would be a declared figure that
 * matches no contract, which is the one thing this module exists to prevent.
 *
 * The contract list is the same queue as "Ready to book" — delivered, not yet
 * booked, this registration — so a sale that cannot legally be declared is not
 * offered in the first place.
 */
export function NewLedgerEntry({
  contracts,
  defaultDate,
}: {
  contracts: BookableContract[];
  defaultDate: string;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [contractId, setContractId] = useState("");
  const [salesDate, setSalesDate] = useState(defaultDate);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [saleType, setSaleType] = useState<string>(DEFAULT_SALE_TYPE);
  const [quantity, setQuantity] = useState("1");

  const picked = contracts.find((c) => c.contract_id === contractId) ?? null;
  const gross = Number(picked?.cash_price ?? 0);
  const split = birSplit(gross);

  function reset() {
    setContractId("");
    setInvoiceNo("");
    setSaleType(DEFAULT_SALE_TYPE);
    setQuantity("1");
    setError("");
  }

  function submit() {
    setError("");
    if (!picked) return setError("Choose the sale from the list.");
    if (!invoiceNo.trim()) return setError("Type the invoice number from the booklet.");
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) return setError("Quantity must be a whole number, 1 or more.");

    startTransition(async () => {
      const res = await bookSale({
        contractId: picked.contract_id,
        invoiceNo,
        salesDate,
        note: "",
        saleType,
        quantity: qty,
      });
      if (res.error) setError(res.error);
      else {
        reset();
        router.refresh();
      }
    });
  }

  if (contracts.length === 0) {
    return (
      <tr>
        <td className={`${cell} text-muted`} colSpan={19}>
          Every delivered sale in this period is already in the book. A new one
          appears on this line once it is marked delivered.
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr className="bg-brand/5 align-top">
        <td className={cell}>
          <input
            type="date"
            aria-label="Date entered in the book"
            className={field}
            value={salesDate}
            onChange={(e) => setSalesDate(e.target.value)}
          />
        </td>
        {/* Name, address and F: one choice fills all three. */}
        <td className={cell} colSpan={3}>
          <select
            aria-label="Sale to enter"
            className={field}
            value={contractId}
            onChange={(e) => {
              setContractId(e.target.value);
              setError("");
            }}
          >
            <option value="">Choose a delivered sale…</option>
            {contracts.map((c) => (
              <option key={c.contract_id} value={c.contract_id}>
                {c.contract_no} — {c.customer_name} — {peso(c.cash_price)}
              </option>
            ))}
          </select>
          {picked && (
            <p className="mt-1 text-micro text-muted">
              {picked.customer_address ?? "No address on file"}
            </p>
          )}
        </td>
        <td className={cell}>
          <input
            aria-label="Invoice number from the booklet"
            className={`${field} font-mono`}
            value={invoiceNo}
            onChange={(e) => setInvoiceNo(e.target.value)}
            placeholder="From the booklet"
          />
        </td>
        <td className={cell} />
        <td className={cellNum} />
        <td className={cellNum}>{picked ? peso(split.vatable) : ""}</td>
        <td className={cellNum} />
        <td className={cellNum}>{picked ? peso(split.inputTax) : ""}</td>
        <td className={cellNum}>{picked ? peso(gross) : ""}</td>
        <td className={cellNum} colSpan={2} />
        <td className={cellNum}>{picked ? peso(gross) : ""}</td>
        <td className={cellNum} />
        <td className={cell}>
          <select
            aria-label="Type of sales"
            className={field}
            value={saleType}
            onChange={(e) => setSaleType(e.target.value)}
          >
            {BIR_SALE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </td>
        <td className={cell}>{picked?.item_description ?? ""}</td>
        <td className={cell}>
          <input
            type="number"
            min={1}
            step={1}
            aria-label="Quantity"
            className={`${field} text-right`}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </td>
        <td className={cell} />
      </tr>
      <tr className="bg-brand/5">
        <td className="border border-line px-2 py-2" colSpan={19}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-micro text-muted">
              The amounts come from the contract and the invoice number from the
              paper booklet — the app never assigns one.
              {saleType === "Government" &&
                " A government buyer withholds VAT; check the invoice before saving."}
            </p>
            <div className="flex items-center gap-2">
              {error && <span className="text-micro font-medium text-danger">{error}</span>}
              {(contractId || invoiceNo) && (
                <button type="button" onClick={reset} disabled={busy} className={btnSecondarySm}>
                  Clear
                </button>
              )}
              <button type="button" onClick={submit} disabled={busy} className={btnPrimarySm}>
                {busy ? "Saving…" : "Add to the book"}
              </button>
            </div>
          </div>
        </td>
      </tr>
    </>
  );
}

const cell = "border border-line px-2 py-1 align-top";
const cellNum = `${cell} text-right tabular-nums`;
/** Compact field for a dense ledger row. Kept at 16px like every other input
 *  in the app — anything smaller makes iOS zoom on focus. */
const field =
  "w-full min-w-28 rounded-card border border-line bg-white px-2 py-1 text-base text-ink focus-visible:border-brand";

/**
 * Correct the two columns of a booked entry that were typed rather than
 * derived.
 *
 * Amounts are absent from this dialog on purpose. They were snapshotted from
 * the contract at booking and a filed figure is not something to nudge; if an
 * amount is wrong the entry is cancelled and booked again, which the audit
 * trail then shows as exactly that.
 */
export function EditEntryDetails({
  entry,
}: {
  entry: { id: string; invoice_no: string; sale_type: string; quantity: number; customer_name_snapshot: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();
  const [saleType, setSaleType] = useState(entry.sale_type);
  const [quantity, setQuantity] = useState(String(entry.quantity));

  function submit() {
    setError("");
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      return setError("Quantity must be a whole number, 1 or more.");
    }
    startTransition(async () => {
      const res = await updateSaleEntryDetails({
        entryId: entry.id,
        saleType,
        quantity: qty,
      });
      if (res.error) setError(res.error);
      else {
        setOpen(false);
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
          setSaleType(entry.sale_type);
          setQuantity(String(entry.quantity));
          setOpen(true);
        }}
        className={btnSecondarySm}
      >
        Edit
      </button>
      <Dialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Correct this entry"
        subtitle={`${entry.customer_name_snapshot} · invoice ${entry.invoice_no}`}
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
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          {error && <Alert tone="danger">{error}</Alert>}
          <p className="text-xs text-muted">
            Only the two columns typed by hand can be corrected here. The
            amounts came from the contract when the sale was booked and are not
            editable — if one is wrong, cancel the entry and book it again.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Type of sales</label>
              <select
                className={selectClass}
                value={saleType}
                onChange={(e) => setSaleType(e.target.value)}
              >
                {BIR_SALE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Quantity</label>
              <input
                type="number"
                min={1}
                step={1}
                className={input}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
          </div>
          {saleType === "Government" && (
            <Alert tone="warning" title="Government buyer.">
              A government buyer withholds VAT. Make sure the invoice and the
              return agree before filing the period.
            </Alert>
          )}
        </div>
      </Dialog>
    </>
  );
}
