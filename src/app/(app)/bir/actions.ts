"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Every write goes through an 0039 RPC. None of these re-checks the role in TS:
// can_manage_bir() is checked inside each function, so a bookkeeper calling one
// of these gets a permission error from Postgres rather than a silent success.
// The UI hides the buttons, but the UI is not the control.

export interface BirExpenseInput {
  expenseDate: string;
  supplierId: string | null;
  supplierName: string;
  docType: string;
  docNo: string;
  grossVat: number;
  grossNonVat: number;
  category: string;
  branch: string;
  note: string;
}

function rpcArgs(input: BirExpenseInput) {
  return {
    p_expense_date: input.expenseDate,
    p_supplier_id: input.supplierId,
    p_supplier_name: input.supplierName,
    p_doc_type: input.docType,
    p_doc_no: input.docNo,
    p_gross_vat: input.grossVat,
    p_gross_non_vat: input.grossNonVat,
    p_category: input.category,
    p_branch: input.branch,
    p_note: input.note,
  };
}

function revalidateBir() {
  revalidatePath("/bir");
  revalidatePath("/bir/expenses");
}

export async function recordBirExpense(input: BirExpenseInput) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_bir_expense", rpcArgs(input));
  if (error) return { error: error.message };
  revalidateBir();
  return {};
}

export async function updateBirExpense(id: string, input: BirExpenseInput) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_bir_expense", {
    p_id: id,
    ...rpcArgs(input),
  });
  if (error) return { error: error.message };
  revalidateBir();
  return {};
}

export async function voidBirExpense(id: string, reason: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_bir_expense", {
    p_id: id,
    p_reason: reason,
  });
  if (error) return { error: error.message };
  revalidateBir();
  return {};
}

export async function upsertBirSupplier(input: {
  id: string | null;
  name: string;
  address: string;
  tin: string;
  vatRegistered: boolean;
  birName: string;
}) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_bir_supplier", {
    p_id: input.id,
    p_name: input.name,
    p_address: input.address,
    p_tin: input.tin,
    p_vat_registered: input.vatRegistered,
    p_bir_name: input.birName,
  });
  if (error) return { error: error.message };
  revalidatePath("/bir/suppliers");
  revalidateBir();
  return {};
}

// ── The sales book ───────────────────────────────────────────
// book_sale derives the branch from contracts.item_type and snapshots the
// cash price itself, so neither can be passed in and got wrong. The invoice
// number is the one thing the caller supplies, and it is typed from the
// booklet — the app never mints it.

export async function bookSale(input: {
  contractId: string;
  invoiceNo: string;
  salesDate: string;
  note: string;
}) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("book_sale", {
    p_contract_id: input.contractId,
    p_invoice_no: input.invoiceNo,
    p_sales_date: input.salesDate,
    p_note: input.note,
  });
  if (error) return { error: error.message };
  revalidatePath("/bir");
  revalidatePath("/bir/sales");
  return {};
}

export async function cancelSaleEntry(entryId: string, reason: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_sale_entry", {
    p_id: entryId,
    p_reason: reason,
  });
  if (error) return { error: error.message };
  revalidatePath("/bir");
  revalidatePath("/bir/sales");
  return {};
}

/**
 * A declared sale with no single contract behind it (0043).
 *
 * Separate from bookSale on purpose: bookSale's value is that SQL derives the
 * amount, branch and customer from the contract, so a caller cannot get them
 * wrong. Here there is no contract to derive from, and the caller must supply
 * everything — which is precisely why it is not folded into the common path.
 */
export async function bookStandaloneSale(input: {
  invoiceNo: string;
  salesDate: string;
  branch: string;
  gross: number;
  customerName: string;
  customerAddress: string;
  item: string;
  note: string;
}) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("book_standalone_sale", {
    p_invoice_no: input.invoiceNo,
    p_sales_date: input.salesDate,
    p_branch: input.branch,
    p_gross: input.gross,
    p_customer_name: input.customerName,
    p_customer_address: input.customerAddress,
    p_item: input.item,
    p_note: input.note,
  });
  if (error) return { error: error.message };
  revalidatePath("/bir");
  revalidatePath("/bir/sales");
  return {};
}
