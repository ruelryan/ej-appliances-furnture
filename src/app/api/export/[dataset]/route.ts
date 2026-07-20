import { NextResponse } from "next/server";
import { createClient, getProfile } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

const DATASETS: Record<
  string,
  { source: string; columns: Array<[key: string, header: string]>; order?: string }
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
      ["collection_status", "Collection Status"],
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
      ["address", "Address"],
      ["messenger_url", "Messenger"],
      ["collection_gc_url", "Collection GC"],
      ["gps_url", "GPS/Map"],
    ],
  },
};

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = Array.isArray(v) ? v.join(" / ") : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
  const def = DATASETS[dataset];
  if (!def) {
    return NextResponse.json({ error: "Unknown dataset" }, { status: 404 });
  }

  const supabase = await createClient();
  let query = supabase.from(def.source).select("*");
  if (def.order) query = query.order(def.order);
  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const header = def.columns.map(([, h]) => csvCell(h)).join(",");
  const lines = ((data ?? []) as Row[]).map((row) =>
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
