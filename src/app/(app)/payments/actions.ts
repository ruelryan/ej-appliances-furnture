"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function recordPayment(input: {
  contractId: string;
  paymentDate: string;
  amount: number;
  receiptNo: string;
  receiptType: string;
  referenceNo: string;
}) {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("record_payment", {
    p_contract_id: input.contractId,
    p_payment_date: input.paymentDate,
    p_amount: input.amount,
    p_receipt_no: input.receiptNo,
    p_receipt_type: input.receiptType,
    p_reference_no: input.referenceNo || null,
  });

  if (error) return { error: error.message };

  revalidatePath(`/contracts/${input.contractId}`);
  revalidatePath("/payments");
  return { paymentId: data.id as string, paymentNo: data.payment_no as string };
}

export async function voidPayment(paymentId: string, reason: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_payment", {
    p_payment_id: paymentId,
    p_reason: reason,
  });

  if (error) return { error: error.message };
  revalidatePath("/payments");
  return {};
}

export async function searchContracts(term: string) {
  const supabase = await createClient();
  const q = term.trim();
  if (!q) return [];

  const { data } = await supabase
    .from("v_contract_financials")
    .select(
      "id, contract_no, display_name, item_description, remaining_balance, monthly_amortization, payment_status"
    )
    .eq("payment_status", "open")
    .or(`contract_no.ilike.%${q}%,display_name.ilike.%${q}%`)
    .order("display_name")
    .limit(10);

  return data ?? [];
}
