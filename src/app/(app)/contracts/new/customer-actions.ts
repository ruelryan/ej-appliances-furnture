"use server";

import { createClient } from "@/lib/supabase/server";

export async function searchCustomers(term: string) {
  const supabase = await createClient();
  const q = term.trim();
  if (q.length < 2) return [];

  const { data } = await supabase
    .from("customers")
    .select("id, display_name, phones, address, messenger_url")
    .ilike("display_name", `%${q}%`)
    .order("display_name")
    .limit(8);

  return data ?? [];
}
