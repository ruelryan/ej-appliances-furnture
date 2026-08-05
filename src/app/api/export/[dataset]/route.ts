import { NextResponse } from "next/server";
import { createClient, getProfile } from "@/lib/supabase/server";

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
  if (profile?.role !== "owner") {
    return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  }

  const { dataset } = await params;
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
