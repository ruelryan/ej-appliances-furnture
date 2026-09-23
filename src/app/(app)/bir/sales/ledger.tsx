import Link from "next/link";
import {
  type LedgerEntry,
  type LedgerRow,
  branchInfo,
  buildLedgerRows,
  ledgerTotals,
} from "@/lib/bir";
import { peso } from "@/lib/format";
import { CancelBooking } from "./book-sale";
import {
  EditEntryDetails,
  NewLedgerEntry,
  type BookableContract,
} from "./ledger-entry";

/**
 * The sales book, laid out as the book.
 *
 * The bookkeeper's "Sales - Appliances" tab is what the office has checked
 * against for years, so the columns are in its order, with its two-row header
 * and its line for every calendar day. Six columns are blank in every row that
 * has ever been written — F, VAT REG. NO., EXEMPTED, ZERO-RATED, LOCAL,
 * SERVICE — and they are drawn anyway, empty. That is the point: column eight
 * on the screen is column eight on the paper, so checking one against the
 * other is a straight left-to-right read rather than a translation.
 *
 * TERMS is not stored anywhere. Every row of the real book puts the whole
 * invoice under CASH and leaves ACCOUNT empty — the bookkeeper's instruction
 * is to treat all sales as cash (Ryan, 2026-09-23), even though most of these
 * are installment contracts. It is rendered here from `gross`, so the app
 * cannot hold a TERMS figure that disagrees with an amount already filed.
 *
 * One ledger is one registration. They keep separate invoice booklets and file
 * separate returns, which is why the workbook has two tabs and why the All
 * view stacks two of these rather than interleaving them.
 */
export function Ledger({
  branch,
  entries,
  start,
  end,
  canManage,
  bookable,
  defaultDate,
}: {
  branch: string;
  entries: LedgerEntry[];
  start: string;
  end: string;
  canManage: boolean;
  bookable: BookableContract[];
  defaultDate: string;
}) {
  const rows = buildLedgerRows(entries, start, end);
  const totals = ledgerTotals(entries);
  const book = branchInfo(branch);

  return (
    <div className="overflow-hidden rounded-card border border-line bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-3 py-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">{book.registeredName}</h3>
          <p className="text-micro text-muted">
            TIN {book.tin} · Summary list of sales · {start} to {end}
          </p>
        </div>
        <p className="text-micro text-muted">
          {totals.count} entr{totals.count === 1 ? "y" : "ies"} · {peso(totals.gross)}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-350 border-collapse text-xs">
          <LedgerHead canManage={canManage} />
          <tbody>
            {rows.map((row) => (
              <LedgerLine key={lineKey(row)} row={row} canManage={canManage} />
            ))}
            {canManage && (
              <NewLedgerEntry
                contracts={bookable}
                defaultDate={clampToPeriod(defaultDate, start, end)}
              />
            )}
          </tbody>
          <LedgerFoot totals={totals} canManage={canManage} />
        </table>
      </div>
    </div>
  );
}

/** The book's two-row header, with the same groupings the paper has.
 *
 *  The trailing column for owner and admin is NOT one of the book's — it holds
 *  the app's own controls. It sits outside the eighteen so that the columns a
 *  person is comparing against the paper keep their positions. */
function LedgerHead({ canManage }: { canManage: boolean }) {
  const top = "border border-line bg-surface px-2 py-1 text-micro font-semibold uppercase tracking-wide text-muted";
  return (
    <thead>
      <tr>
        <th className={top} rowSpan={2}>Date</th>
        <th className={top} rowSpan={2}>Name</th>
        <th className={top} rowSpan={2}>Address</th>
        <th className={top} rowSpan={2}>F</th>
        <th className={top} rowSpan={2}>Invoice numbers</th>
        <th className={top} rowSpan={2}>VAT reg. no.</th>
        <th className={top}>Sales</th>
        <th className={top} colSpan={2}>Taxable sales</th>
        <th className={top} rowSpan={2}>VAT output tax</th>
        <th className={top} rowSpan={2}>Total invoice amount</th>
        <th className={top} colSpan={2}>Classification of sales</th>
        <th className={top} colSpan={2}>Terms</th>
        <th className={top} rowSpan={2}>Type of sales</th>
        <th className={top} rowSpan={2}>Item description</th>
        <th className={top} rowSpan={2}>Quantity</th>
        {canManage && <th className={top} rowSpan={2} aria-label="Actions" />}
      </tr>
      <tr>
        <th className={top}>Exempted</th>
        <th className={top}>12%</th>
        <th className={top}>Zero-rated</th>
        <th className={top}>Local</th>
        <th className={top}>Service</th>
        <th className={top}>Cash</th>
        <th className={top}>Account</th>
      </tr>
    </thead>
  );
}

const cell = "border border-line px-2 py-1 align-top";
const cellNum = `${cell} text-right tabular-nums`;

function LedgerLine({ row, canManage }: { row: LedgerRow; canManage: boolean }) {
  // A day with no sale. The paper book writes the line rather than skipping the
  // day, and so does this: a day that is simply absent looks exactly like a day
  // somebody forgot to write up.
  if (row.kind === "none") {
    return (
      <tr className="text-muted">
        <td className={`${cell} whitespace-nowrap`}>{dayLabel(row.date)}</td>
        <td className={cell}>No transaction</td>
        <td className={cell}>-</td>
        {Array.from({ length: 15 }, (_, i) => (
          <td key={i} className={cell} />
        ))}
        {canManage && <td className={cell} />}
      </tr>
    );
  }

  const e = row.entry;
  return (
    <tr className="text-ink">
      <td className={`${cell} whitespace-nowrap`}>{row.first ? dayLabel(row.date) : ""}</td>
      <td className={cell}>
        {canManage && e.contract_id ? (
          <Link href={`/contracts/${e.contract_id}`} className="hover:underline">
            {e.customer_name_snapshot}
          </Link>
        ) : (
          e.customer_name_snapshot
        )}
      </td>
      <td className={cell}>{e.customer_address_snapshot ?? "-"}</td>
      {/* F — a folio reference the book has never used. Drawn, never filled. */}
      <td className={cell} />
      <td className={`${cell} whitespace-nowrap font-mono`}>{e.invoice_no}</td>
      <td className={cell} />
      {/* Exempted and zero-rated: no E & J sale has ever been either. */}
      <td className={cellNum} />
      <td className={cellNum}>{peso(e.vatable_sales)}</td>
      <td className={cellNum} />
      <td className={cellNum}>{peso(e.vat_output_tax)}</td>
      <td className={cellNum}>{peso(e.gross_snapshot)}</td>
      {/* Classification: goods, never service — left blank as the book leaves it. */}
      <td className={cellNum} />
      <td className={cellNum} />
      {/* All sales are booked as cash, on the bookkeeper's instruction. */}
      <td className={cellNum}>{peso(e.gross_snapshot)}</td>
      <td className={cellNum} />
      <td className={cell}>{e.sale_type}</td>
      <td className={cell}>{e.item_snapshot ?? "-"}</td>
      <td className={cellNum}>{e.quantity}</td>
      {canManage && (
        <td className={`${cell} whitespace-nowrap`}>
          <div className="flex gap-1">
            <EditEntryDetails entry={e} />
            <CancelBooking
              row={{
                id: e.id,
                contract_id: e.contract_id,
                invoice_no: e.invoice_no,
                sales_date: e.sales_date,
                branch: e.branch,
                gross_snapshot: e.gross_snapshot,
                customer_name_snapshot: e.customer_name_snapshot,
                item_snapshot: e.item_snapshot,
              }}
            />
          </div>
        </td>
      )}
    </tr>
  );
}

function LedgerFoot({
  totals,
  canManage,
}: {
  totals: ReturnType<typeof ledgerTotals>;
  canManage: boolean;
}) {
  const foot = "border border-line bg-surface px-2 py-1 font-semibold";
  const footNum = `${foot} text-right tabular-nums`;
  return (
    <tfoot>
      <tr>
        <td className={foot} colSpan={7}>
          Total for the period
        </td>
        <td className={footNum}>{peso(totals.vatable)}</td>
        <td className={footNum} />
        <td className={footNum}>{peso(totals.output)}</td>
        <td className={footNum}>{peso(totals.gross)}</td>
        <td className={footNum} colSpan={2} />
        <td className={footNum}>{peso(totals.cash)}</td>
        <td className={footNum} colSpan={canManage ? 5 : 4} />
      </tr>
    </tfoot>
  );
}

/** "Sep 2" — the book writes the day, and the period header carries the year. */
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function lineKey(row: LedgerRow): string {
  return row.kind === "none" ? row.date : row.entry.id;
}

/** Today, unless the ledger is open on a past period — then the period's own
 *  last day, so the entry row cannot silently write a sale into a month the
 *  user is not looking at. */
function clampToPeriod(today: string, start: string, end: string): string {
  if (today < start) return start;
  if (today > end) return end;
  return today;
}
