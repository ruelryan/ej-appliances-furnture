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
