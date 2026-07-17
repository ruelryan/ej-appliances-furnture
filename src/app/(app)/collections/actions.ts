"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function revalidate() {
  revalidatePath("/collections");
  revalidatePath("/collections/report");
}

// ── Assignment (owner/admin) ──────────────────────────────────
export async function assignCollector(input: {
  contractId: string;
  collectorId: string | null;
  priority: number | null;
}) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_collector", {
    p_contract_id: input.contractId,
    p_collector_id: input.collectorId,
    p_priority: input.priority,
  });
  if (error) return { error: error.message };
  revalidate();
  revalidatePath(`/contracts/${input.contractId}`);
  return {};
}

// ── Collector logs a collection / visit outcome ───────────────
export async function logCollection(input: {
  contractId: string;
  amount: number;
  method: string | null;
  reference: string;
  disposition: string;
  note: string;
}) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("log_collection", {
    p_contract_id: input.contractId,
    p_amount: input.amount,
    p_method: input.method,
    p_reference: input.reference || null,
    p_disposition: input.disposition,
    p_note: input.note || null,
  });
  if (error) return { error: error.message };
  revalidate();
  return {};
}

// ── Owner/admin posts a pending entry into a real payment ─────
export async function postCollectionEntry(input: {
  entryId: string;
  receiptNo: string;
  receiptType: string;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("post_collection_entry", {
    p_entry_id: input.entryId,
    p_receipt_no: input.receiptNo,
    p_receipt_type: input.receiptType,
  });
  if (error) return { error: error.message };
  revalidate();
  revalidatePath("/payments");
  return { paymentId: data.id as string };
}

export async function cancelCollectionEntry(entryId: string, reason: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_collection_entry", {
    p_entry_id: entryId,
    p_reason: reason || null,
  });
  if (error) return { error: error.message };
  revalidate();
  return {};
}

// ── Cash advances ─────────────────────────────────────────────
export async function requestCashAdvance(input: {
  amount: number;
  purpose: string;
}) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_cash_advance", {
    p_amount: input.amount,
    p_purpose: input.purpose || null,
  });
  if (error) return { error: error.message };
  revalidate();
  return {};
}

export async function issueCashAdvance(input: {
  collectorId: string;
  amount: number;
  purpose: string;
}) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("issue_cash_advance", {
    p_collector_id: input.collectorId,
    p_amount: input.amount,
    p_purpose: input.purpose || null,
  });
  if (error) return { error: error.message };
  revalidate();
  return {};
}

export async function approveCashAdvance(advanceId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_cash_advance", {
    p_advance_id: advanceId,
  });
  if (error) return { error: error.message };
  revalidate();
  return {};
}

export async function declineCashAdvance(advanceId: string, reason: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("decline_cash_advance", {
    p_advance_id: advanceId,
    p_reason: reason || null,
  });
  if (error) return { error: error.message };
  revalidate();
  return {};
}

export async function addAdvanceExpense(input: {
  advanceId: string;
  description: string;
  amount: number;
  receiptRef: string;
}) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_advance_expense", {
    p_advance_id: input.advanceId,
    p_description: input.description,
    p_amount: input.amount,
    p_receipt_ref: input.receiptRef || null,
  });
  if (error) return { error: error.message };
  revalidate();
  return {};
}

export async function closeCashAdvance(advanceId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_cash_advance", {
    p_advance_id: advanceId,
  });
  if (error) return { error: error.message };
  revalidate();
  return {};
}
