"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { PayslipLine } from "./types";

function revalidateSlip(id?: string) {
  revalidatePath("/payroll");
  if (id) revalidatePath(`/payroll/${id}`);
}

export async function createPayslip(profileId: string, periodStart: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_payslip", {
    p_profile_id: profileId,
    p_period_start: periodStart,
  });
  if (error) return { error: error.message };
  revalidateSlip();
  return { id: data.id as string };
}

export async function updatePayslipLines(
  id: string,
  extraIncome: PayslipLine[],
  extraDeductions: PayslipLine[]
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_payslip_lines", {
    p_id: id,
    p_extra_income: extraIncome,
    p_extra_deductions: extraDeductions,
  });
  if (error) return { error: error.message };
  revalidateSlip(id);
  return {};
}

export async function refreshPayslip(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("refresh_payslip", { p_id: id });
  if (error) return { error: error.message };
  revalidateSlip(id);
  return {};
}

export async function finalizePayslip(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("finalize_payslip", { p_id: id });
  if (error) return { error: error.message };
  revalidateSlip(id);
  return {};
}

export async function reopenPayslip(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_payslip", { p_id: id });
  if (error) return { error: error.message };
  revalidateSlip(id);
  return {};
}

export async function deletePayslip(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_payslip", { p_id: id });
  if (error) return { error: error.message };
  revalidateSlip(id);
  return {};
}

// ── 13th-month pay ───────────────────────────────────────────
// Entitlement is computed by v_thirteenth_month from the basic_pay snapshot on
// FINAL payslips (1/12 of basic salary earned in the calendar year). Payments
// are recorded here rather than inferred from a magic label in extra_income —
// parsing a fact back out of free text would be fragile.
export async function record13thMonthPayment(
  profileId: string,
  year: number,
  amount: number,
  paidOn: string | null,
  note: string
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_13th_month_payment", {
    p_profile_id: profileId,
    p_year: year,
    p_amount: amount,
    p_paid_on: paidOn,
    p_note: note || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/payroll/13th-month");
  return {};
}
