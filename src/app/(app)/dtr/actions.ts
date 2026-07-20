"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface PunchCoords {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
}

export async function clockIn(coords: PunchCoords) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("clock_in", {
    p_lat: coords.lat,
    p_lng: coords.lng,
    p_accuracy_m: coords.accuracy,
  });
  if (error) return { error: error.message };
  revalidatePath("/dtr");
  return {};
}

export async function clockOut(coords: PunchCoords) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("clock_out", {
    p_lat: coords.lat,
    p_lng: coords.lng,
    p_accuracy_m: coords.accuracy,
  });
  if (error) return { error: error.message };
  revalidatePath("/dtr");
  return {};
}

export async function upsertTimeRecord(input: {
  profileId: string;
  workDate: string;
  timeIn: string;
  timeOut: string;
  note: string;
}) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_time_record", {
    p_profile_id: input.profileId,
    p_work_date: input.workDate,
    p_time_in: input.timeIn,
    p_time_out: input.timeOut || null,
    p_note: input.note || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/dtr");
  return {};
}

export async function deleteTimeRecord(recordId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_time_record", {
    p_id: recordId,
  });
  if (error) return { error: error.message };
  revalidatePath("/dtr");
  return {};
}

export async function requestTimeCorrection(input: {
  workDate: string;
  timeIn: string;
  timeOut: string;
  reason: string;
}) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_time_correction", {
    p_work_date: input.workDate,
    p_time_in: input.timeIn,
    p_time_out: input.timeOut || null,
    p_reason: input.reason,
  });
  if (error) return { error: error.message };
  revalidatePath("/dtr");
  return {};
}

export async function cancelTimeCorrection(requestId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_time_correction", {
    p_request_id: requestId,
  });
  if (error) return { error: error.message };
  revalidatePath("/dtr");
  return {};
}

export async function resolveTimeCorrection(
  requestId: string,
  approve: boolean
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_time_correction", {
    p_request_id: requestId,
    p_approve: approve,
  });
  if (error) return { error: error.message };
  revalidatePath("/dtr");
  return {};
}

export async function setHourlyRate(profileId: string, rate: number) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_hourly_rate", {
    p_profile_id: profileId,
    p_rate: rate,
  });
  if (error) return { error: error.message };
  revalidatePath("/dtr");
  revalidatePath("/dtr/settings");
  return {};
}

export async function setContributions(
  profileId: string,
  amounts: {
    philhealthEe: number;
    philhealthEr: number;
    sssEe: number;
    sssEr: number;
    pagibigEe: number;
    pagibigEr: number;
  }
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_contributions", {
    p_profile_id: profileId,
    p_philhealth_ee: amounts.philhealthEe,
    p_philhealth_er: amounts.philhealthEr,
    p_sss_ee: amounts.sssEe,
    p_sss_er: amounts.sssEr,
    p_pagibig_ee: amounts.pagibigEe,
    p_pagibig_er: amounts.pagibigEr,
  });
  if (error) return { error: error.message };
  revalidatePath("/dtr/settings");
  revalidatePath("/payroll");
  return {};
}

export async function addHoliday(input: {
  date: string;
  name: string;
  type: "regular" | "special";
}) {
  const supabase = await createClient();
  const { error } = await supabase.from("holidays").upsert({
    holiday_date: input.date,
    name: input.name.trim(),
    type: input.type,
  });
  if (error) return { error: error.message };
  revalidatePath("/dtr");
  revalidatePath("/dtr/settings");
  return {};
}

export async function deleteHoliday(date: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("holidays")
    .delete()
    .eq("holiday_date", date);
  if (error) return { error: error.message };
  revalidatePath("/dtr");
  revalidatePath("/dtr/settings");
  return {};
}

export async function addDtrLocation(input: {
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
}) {
  const supabase = await createClient();
  const { error } = await supabase.from("dtr_locations").insert({
    name: input.name.trim(),
    lat: input.lat,
    lng: input.lng,
    radius_m: input.radiusM,
  });
  if (error) return { error: error.message };
  revalidatePath("/dtr");
  revalidatePath("/dtr/settings");
  return {};
}

export async function setDtrLocationActive(id: string, active: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("dtr_locations")
    .update({ active })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dtr");
  revalidatePath("/dtr/settings");
  return {};
}

export async function deleteDtrLocation(id: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("dtr_locations")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dtr");
  revalidatePath("/dtr/settings");
  return {};
}
