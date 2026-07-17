"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function revalidate(contractId?: string) {
  revalidatePath("/commissions");
  if (contractId) revalidatePath(`/contracts/${contractId}`);
}

export async function markCommissionPaid(
  commissionId: string,
  reference: string,
  contractId?: string
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_commission_paid", {
    p_commission_id: commissionId,
    p_reference: reference || null,
  });
  if (error) return { error: error.message };
  revalidate(contractId);
  return {};
}

export async function unmarkCommissionPaid(
  commissionId: string,
  contractId?: string
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("unmark_commission_paid", {
    p_commission_id: commissionId,
  });
  if (error) return { error: error.message };
  revalidate(contractId);
  return {};
}

export async function voidCommission(
  commissionId: string,
  reason: string,
  contractId?: string
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_commission", {
    p_commission_id: commissionId,
    p_reason: reason || null,
  });
  if (error) return { error: error.message };
  revalidate(contractId);
  return {};
}
