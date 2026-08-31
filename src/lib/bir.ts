/**
 * BIR bookkeeping constants and period helpers.
 *
 * No "use client" on purpose: both server pages and client dialogs read these,
 * and a constant exported from a client module reaches the server as a
 * client-reference proxy rather than as the value — the bug that took the Tasks
 * page down for a month (see client-boundary.test.ts).
 *
 * `birSplit` is a TS MIRROR of SQL `bir_split()` (0039), exactly as
 * `computeTerms()` mirrors `compute_terms()`: the stored numbers always come
 * from SQL, and this copy exists only so the entry form can show the split
 * before saving. Change one, change the other, and keep BIR_SPLIT_CASES green.
 */

/**
 * The two VAT registrations.
 *
 * E & J is not one registered taxpayer but two branches on one base TIN, and
 * they file separately — which is why the Sales Journal has always kept
 * Appliances and Furniture as separate monthly columns, and why an expense has
 * to say which book it belongs to.
 *
 * There is no third "shared" value. Overhead — utilities, salaries — is paid
 * by the Appliances registration (Ryan, 2026-08-31), so it is recorded there.
 * An unallocated bucket would only produce rows belonging to neither book, and
 * therefore filable in neither return. 0040 removed it.
 */
export const BIR_REGISTERED_ADDRESS = "Bogo, Tomas Oppus, Southern Leyte 6605";

export const BIR_BRANCHES = [
  {
    value: "appliances",
    label: "Appliances",
    registeredName: "E & J APPLIANCES STORE",
    tin: "437-961-107-00000",
  },
  {
    value: "furniture",
    label: "Furniture",
    registeredName: "E & J FURNITURE STORE",
    tin: "437-961-107-00001",
  },
] as const;

export type BirBranch = (typeof BIR_BRANCHES)[number]["value"];

/** Falls back to Appliances, which is where overhead belongs and where any
 *  pre-0040 'shared' row was moved. */
export function branchInfo(value: string) {
  return BIR_BRANCHES.find((b) => b.value === value) ?? BIR_BRANCHES[0];
}

/** The default for a new expense. Overhead is paid by Appliances and that is
 *  most of what gets typed; Furniture is the deliberate switch. */
export const DEFAULT_BRANCH: BirBranch = "appliances";

/** `contracts.item_type` is constrained to exactly 'Appliances' | 'Furniture'
 *  (0003), which is the same split as the two registrations — so Phase 2 can
 *  map a sale to its branch without anyone tagging it by hand. */
export function branchForItemType(itemType: string | null): BirBranch {
  if (itemType === "Appliances") return "appliances";
  if (itemType === "Furniture") return "furniture";
  // Unknown item type: Appliances carries the overhead, so it is the safe home.
  return "appliances";
}

/** Expense categories, matching the Expenses tab of the General workbook.
 *  The sheet spells one of them OFFICE SUPPLES; it is corrected here, and any
 *  importer must map the old spelling across. */
export const BIR_CATEGORIES = [
  "PURCHASES",
  "COST OF SALES",
  "SALARIES WAGES AND ALLOWANCE",
  "TRANSPORTATION AND TRAVEL",
  "TAXES AND LICENSES (2551/2550)",
  "PROFESSIONAL FEE",
  "RENTALS",
  "UTILITIES LIGHTS AND WATER",
  "MAINTENANCE EXPENSES",
  "OFFICE SUPPLIES",
  "OFFICE EQUIPMENT",
  "MEALS AND REPRESENTATION",
  "ENTERTAINMENT AND AMUSEMENT",
  "MISCELLANEOUS",
  "ASSET",
  "AMORTIZATION",
  "DEPRECIATION",
  "BAD DEBTS",
  "CHARITABLE AND OTHERS",
  "OFFICIAL RECEIPTS",
  "SSS GSIS PHILHEALTH",
] as const;

export type BirCategory = (typeof BIR_CATEGORIES)[number];

/** What kind of document backs the expense. Since RA 11976 (Ease of Paying
 *  Taxes) and RR 7-2024 the Sales Invoice is the primary VAT document; an
 *  Official Receipt issued after 2024-12-31 is supplementary and cannot
 *  support an input-tax claim. `claimCutoff` is what the form warns against. */
export const DOC_TYPES = [
  { value: "sales_invoice", label: "Sales invoice" },
  { value: "official_receipt", label: "Official receipt" },
  { value: "none", label: "No document" },
] as const;

export const OR_INPUT_TAX_CUTOFF = "2024-12-31";

/** True when this row claims input VAT on a document that cannot support it. */
export function orCannotClaimInputTax(
  docType: string,
  expenseDate: string,
  grossVat: number
): boolean {
  return (
    docType === "official_receipt" &&
    grossVat > 0 &&
    expenseDate > OR_INPUT_TAX_CUTOFF
  );
}

/** `MMYYYY` with no leading zero — July 2021 is "72021". Mirrors
 *  `to_char(expense_date, 'FMMMYYYY')` in 0039 so the export matches the
 *  bookkeeper's workbook exactly. */
export function periodKey(iso: string): string {
  const [y, m] = iso.split("-");
  return `${Number(m)}${y}`;
}

/** First and last day of a month, as ISO dates. `month` is "YYYY-MM". */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

/** First and last day of a quarter. `quarter` is "YYYY-Q1".."YYYY-Q4". */
export function quarterRange(quarter: string): { start: string; end: string } {
  const [y, q] = quarter.split("-Q").map(Number);
  const firstMonth = (q - 1) * 3 + 1;
  const lastMonth = firstMonth + 2;
  const last = new Date(Date.UTC(y, lastMonth, 0)).getUTCDate();
  return {
    start: `${y}-${String(firstMonth).padStart(2, "0")}-01`,
    end: `${y}-${String(lastMonth).padStart(2, "0")}-${last}`,
  };
}

/** Resolve a `?period=` value to a date range. Accepts "YYYY-MM" or "YYYY-Qn";
 *  anything else falls back to the current month in Manila. */
export function resolvePeriod(period: string | undefined, todayISO: string) {
  if (period && /^\d{4}-Q[1-4]$/.test(period)) {
    return { label: period.replace("-Q", " Q"), ...quarterRange(period) };
  }
  const month = period && /^\d{4}-\d{2}$/.test(period) ? period : todayISO.slice(0, 7);
  return { label: month, ...monthRange(month) };
}

/**
 * VAT-inclusive gross -> (vatable, input tax). Mirrors SQL `bir_split()`.
 *
 * Rounds the vatable base and takes the input tax as the remainder, rather
 * than rounding both: rounding twice lets `vatable + input` miss the gross by
 * a centavo, and the bookkeeper's workbook foots every column.
 */
export function birSplit(grossVat: number): { vatable: number; inputTax: number } {
  const vatable = Math.round((grossVat / 1.12) * 100) / 100;
  return { vatable, inputTax: Math.round((grossVat - vatable) * 100) / 100 };
}

/** Real rows from the Expenses tab, used as golden cases in the unit test. */
export const BIR_SPLIT_CASES: { gross: number; vatable: number; inputTax: number }[] = [
  { gross: 2015.1, vatable: 1799.2, inputTax: 215.9 },
  { gross: 500, vatable: 446.43, inputTax: 53.57 },
  { gross: 530, vatable: 473.21, inputTax: 56.79 },
  { gross: 8500, vatable: 7589.29, inputTax: 910.71 },
  { gross: 17500, vatable: 15625, inputTax: 1875 },
  { gross: 6521.25, vatable: 5822.54, inputTax: 698.71 },
  { gross: 16611, vatable: 14831.25, inputTax: 1779.75 },
  { gross: 52000, vatable: 46428.57, inputTax: 5571.43 },
  { gross: 8960, vatable: 8000, inputTax: 960 },
  { gross: 0, vatable: 0, inputTax: 0 },
];
