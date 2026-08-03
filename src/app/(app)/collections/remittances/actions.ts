"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function revalidate() {
  revalidatePath("/collections/remittances");
  revalidatePath("/collections");
  revalidatePath("/collections/report");
}

// ── Owner/admin records cash handed in by a collector ─────────
export async function recordRemittance(input: {
  collectorId: string;
  amount: number;
  remittedOn: string | null;
  note: string;
}) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_remittance", {
    p_collector_id: input.collectorId,
    p_amount: input.amount,
    p_remitted_on: input.remittedOn || null,
    p_note: input.note || null,
  });
  if (error) return { error: error.message };
  revalidate();
  return {};
}

// ── Owner cancels one (money rows are never deleted) ──────────
export async function cancelRemittance(remittanceId: string, reason: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_remittance", {
    p_remittance_id: remittanceId,
    p_reason: reason || null,
  });
  if (error) return { error: error.message };
  revalidate();
  return {};
}
