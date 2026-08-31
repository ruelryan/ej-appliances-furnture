import { NextResponse } from "next/server";
import { canSeeBir, createClient, getProfile } from "@/lib/supabase/server";
import {
  BIR_BRANCHES,
  BIR_REGISTERED_ADDRESS,
  branchInfo,
  resolvePeriod,
} from "@/lib/bir";
import { phTodayISO } from "@/lib/format";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

// `order` is required, not optional: it is the stable sort that makes
// pagination safe (see fetchAllRows).
const DATASETS: Record<
  string,
  { source: string; columns: Array<[key: string, header: string]>; order: string }
> = {
  contracts: {
    source: "v_contract_financials",
    order: "contract_no",
    columns: [
      ["contract_no", "Contract No"],
      ["contract_date", "Date"],
      ["display_name", "Customer"],
      ["item_description", "Item"],
      ["item_type", "Item Type"],
      ["quantity", "Qty"],
      ["cash_price", "Cash Price"],
      ["term_months", "Term (months)"],
      ["total_price", "Total Price"],
      ["downpayment", "Downpayment"],
      ["monthly_amortization", "Monthly"],
      ["total_paid", "Total Paid"],
      ["expected_to_date", "Expected To Date"],
      ["overdue_amount", "Past Due"],
      ["remaining_balance", "Remaining Balance"],
      ["sales_agent", "Sales Agent"],
      ["payment_status", "Payment Status"],
      ["delivery_status", "Delivery Status"],
      ["repossession_stage", "Repossession Stage"],
      ["collection_situation", "Collection Situation"],
      ["followup_tier", "Follow-up Tier"],
    ],
  },
  payments: {
    source: "payments",
    order: "payment_no",
    columns: [
      ["payment_no", "Payment No"],
      ["payment_date", "Date"],
      ["amount", "Amount"],
      ["receipt_no", "Receipt No"],
      ["receipt_type", "Receipt Type"],
      ["reference_no", "Reference No"],
      ["voided_at", "Voided At"],
      ["void_reason", "Void Reason"],
    ],
  },
  aging: {
    source: "v_aging",
    order: "bucket",
    columns: [
      ["bucket", "Bucket"],
      ["contract_count", "Contracts"],
      ["overdue_total", "Past Due Total"],
      ["balance_total", "Balance Total"],
    ],
  },
  customers: {
    source: "customers",
    order: "display_name",
    columns: [
      ["display_name", "Name"],
      ["phones", "Phones"],
      ["address", "Address (as given)"],
      ["province", "Province"],
      ["municipality", "Municipality"],
      ["barangay", "Barangay"],
      ["street_purok", "Street/Purok"],
      ["landmark", "Landmark"],
      ["messenger_url", "Messenger"],
      ["collection_gc_url", "Collection GC"],
      ["gps_url", "GPS/Map"],
    ],
  },
};

// PostgREST caps a read at 1000 rows. The exports are the numbers the owner
// reconciles against, and payments alone is ~5,900 rows, so a single select
// silently dropped most of the ledger with no error. Always paginate, always
// with a stable sort — without one the pages overlap and drop rows (the same
// trap that produced a phantom discrepancy in a verification script).
const PAGE_SIZE = 1000;

async function fetchAllRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  source: string,
  order: string
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(source)
      .select("*")
      .order(order)
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

// Excel and Sheets treat a cell opening with = + - @ (or a control character)
// as a formula, so a value typed into the app — a landmark, a note, a void
// reason — can execute when the owner opens the export. This route explicitly
// targets Excel (it prepends a BOM), so neutralize it: a leading apostrophe
// marks the cell as text. It also fixes a quieter bug, since Excel was already
// eating the "+" on phone numbers like +639171234567 and rendering them as a
// plain number.
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = Array.isArray(v) ? v.join(" / ") : String(v);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dataset: string }> }
) {
  const profile = await getProfile();
  const { dataset } = await params;

  // The purchase journal is the one export a bookkeeper may take, so it is
  // gated on can_see_bir() rather than the owner-only rule the other four use.
  // It also needs a period filter and a supplier join, which the generic
  // DATASETS shape has no room for — hence its own path rather than a fifth
  // entry bent out of shape.
  if (dataset === "bir-expenses" || dataset === "bir-sales") {
    if (!profile || !canSeeBir(profile.role)) {
      return NextResponse.json({ error: "BIR access required" }, { status: 403 });
    }
    return dataset === "bir-sales"
      ? exportBirSales(_req)
      : exportBirExpenses(_req);
  }

  if (profile?.role !== "owner") {
    return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  }

  // hasOwn, not a bare index: "constructor" and "toString" reach Object's
  // prototype and would sail past a truthiness check.
  if (!Object.hasOwn(DATASETS, dataset)) {
    return NextResponse.json({ error: "Unknown dataset" }, { status: 404 });
  }
  const def = DATASETS[dataset];

  const supabase = await createClient();

  let data: Row[];
  try {
    data = await fetchAllRows(supabase, def.source, def.order);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Export failed" },
      { status: 500 }
    );
  }

  const header = def.columns.map(([, h]) => csvCell(h)).join(",");
  const lines = data.map((row) =>
    def.columns.map(([k]) => csvCell(row[k])).join(",")
  );

  // UTF-8 BOM so Excel renders ₱ and accented names correctly
  const csv = "﻿" + [header, ...lines].join("\r\n");
  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="eandj-${dataset}-${today}.csv"`,
    },
  });
}

/**
 * The bookkeeper's monthly purchase journal, in the column order of the sheet
 * they already receive — DATE, NAME & ADDRESS OF SUPPLIERS, INVOICE #, VAT REG
 * NO./TIN, then the money columns, TOTAL, CATEGORY — so it pastes straight
 * into the workbook.
 *
 * Voided rows are excluded: a void means the document should never have been in
 * the book at all. The struck-through row on screen is an audit affordance, not
 * something to hand a bookkeeper.
 */
async function exportBirExpenses(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const range = resolvePeriod(
    url.searchParams.get("period") ?? undefined,
    phTodayISO()
  );
  // E & J files two VAT registrations separately, so a book has to say which
  // one it is. "all" is for the office's own review, not for filing.
  const branch = url.searchParams.get("branch") ?? "all";
  const scoped = BIR_BRANCHES.some((b) => b.value === branch);

  const supabase = await createClient();
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let q = supabase
      .from("bir_expenses")
      .select(
        "id, expense_date, supplier_name_snapshot, doc_no, doc_type, gross_vat, gross_non_vat, vatable_purchases, vat_input_tax, total, category, branch, period_key, note, suppliers(address, tin)"
      )
      .is("voided_at", null)
      .gte("expense_date", range.start)
      .lte("expense_date", range.end);

    if (scoped) q = q.eq("branch", branch);

    const { data, error } = await q
      // Stable sort, as everywhere else that paginates here: without one the
      // pages overlap and silently drop rows.
      .order("expense_date")
      .order("id")
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  type Joined = { address?: string | null; tin?: string | null } | null;
  const columns: Array<[string, (r: Row) => unknown]> = [
    ["DATE", (r) => r.expense_date],
    ["NAME & ADDRESS OF SUPPLIERS", (r) => r.supplier_name_snapshot],
    ["ADDRESS", (r) => (r.suppliers as Joined)?.address ?? ""],
    ["INVOICE #", (r) => r.doc_no],
    ["VAT REG NO./TIN", (r) => (r.suppliers as Joined)?.tin ?? ""],
    ["VATABLE PURCHASES", (r) => r.vatable_purchases],
    ["VAT INPUT TAX", (r) => r.vat_input_tax],
    ["TOTAL AMOUNT PAID (VAT)", (r) => (Number(r.gross_vat) > 0 ? r.gross_vat : "")],
    [
      "TOTAL AMOUNT PAID (NON VAT)",
      (r) => (Number(r.gross_non_vat) > 0 ? r.gross_non_vat : ""),
    ],
    ["TOTAL", (r) => r.total],
    ["CATEGORY", (r) => r.category],
    ["BOOK", (r) => branchInfo(String(r.branch)).label],
    ["PERIOD", (r) => r.period_key],
    ["DOCUMENT", (r) => r.doc_type],
    ["NOTE", (r) => r.note],
  ];

  // A book has to identify its own registration — there are two, and a journal
  // that does not say which TIN it belongs to cannot be filed against either.
  const info = scoped ? branchInfo(branch) : null;
  const preamble = [
    [info ? info.registeredName : "E & J APPLIANCES FURNITURE"],
    [info ? `TIN ${info.tin}` : "ALL BOOKS — for review, not for filing"],
    [BIR_REGISTERED_ADDRESS],
    ["SUBSIDIARY PURCHASE JOURNAL"],
    [`${range.start} to ${range.end}`],
    [],
  ].map((cells) => cells.map(csvCell).join(","));

  const header = columns.map(([h]) => csvCell(h)).join(",");
  const lines = rows.map((r) =>
    columns.map(([, get]) => csvCell(get(r))).join(",")
  );

  // Same BOM as the four owner exports, so Excel renders ₱ and accented names.
  const csv = "﻿" + [...preamble, header, ...lines].join("\r\n");
  const suffix = scoped ? branch : "all";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="eandj-bir-expenses-${suffix}-${range.start}-to-${range.end}.csv"`,
    },
  });
}

/**
 * The Summary List of Sales, in the column order of the sheet the bookkeeper
 * already receives: DATE, NAME, ADDRESS, INVOICE NUMBERS, VAT REG NO., the
 * three sales buckets, VAT OUTPUT TAX, TOTAL INVOICE AMOUNT.
 *
 * Cancelled entries are excluded — a cancelled entry means the sale should not
 * have been in the book, and the invoice number has been freed for reuse.
 *
 * Every customer here is a walk-in individual, so EXEMPT and ZERO-RATED are
 * always blank and VAT REG NO. is empty: those columns exist because the BIR
 * form has them, not because this business has such sales.
 */
async function exportBirSales(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const range = resolvePeriod(url.searchParams.get("period") ?? undefined, phTodayISO());
  const branch = url.searchParams.get("branch") ?? "all";
  const scoped = BIR_BRANCHES.some((b) => b.value === branch);

  const supabase = await createClient();
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let q = supabase
      .from("bir_sales_entries")
      .select(
        "id, sales_date, invoice_no, branch, gross_snapshot, vatable_sales, vat_output_tax, customer_name_snapshot, customer_address_snapshot, item_snapshot, period_key"
      )
      .is("cancelled_at", null)
      .gte("sales_date", range.start)
      .lte("sales_date", range.end);

    if (scoped) q = q.eq("branch", branch);

    const { data, error } = await q
      .order("sales_date")
      .order("id")
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  const columns: Array<[string, (r: Row) => unknown]> = [
    ["DATE", (r) => r.sales_date],
    ["NAME", (r) => r.customer_name_snapshot],
    ["ADDRESS", (r) => r.customer_address_snapshot],
    ["INVOICE NUMBERS", (r) => r.invoice_no],
    ["VAT REG. NO.", () => ""],
    ["SALES EXEMPTED", () => ""],
    ["TAXABLE SALES 12%", (r) => r.vatable_sales],
    ["TAXABLE SALES ZERO-RATED", () => ""],
    ["VAT OUTPUT TAX", (r) => r.vat_output_tax],
    ["TOTAL INVOICE AMOUNT", (r) => r.gross_snapshot],
    ["ITEM", (r) => r.item_snapshot],
    ["BOOK", (r) => branchInfo(String(r.branch)).label],
    ["PERIOD", (r) => r.period_key],
  ];

  const info = scoped ? branchInfo(branch) : null;
  const preamble = [
    [info ? info.registeredName : "E & J APPLIANCES FURNITURE"],
    [info ? `TIN ${info.tin}` : "BOTH BOOKS — for review, not for filing"],
    [BIR_REGISTERED_ADDRESS],
    ["SUMMARY LIST OF SALES"],
    [`${range.start} to ${range.end}`],
    [],
  ].map((cells) => cells.map(csvCell).join(","));

  const header = columns.map(([h]) => csvCell(h)).join(",");
  const lines = rows.map((r) =>
    columns.map(([, get]) => csvCell(get(r))).join(",")
  );

  const csv = "\ufeff" + [...preamble, header, ...lines].join("\r\n");
  const suffix = scoped ? branch : "all";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="eandj-bir-sales-${suffix}-${range.start}-to-${range.end}.csv"`,
    },
  });
}
