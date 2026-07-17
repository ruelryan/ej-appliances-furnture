"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function submitLead(input: {
  customerName: string;
  phone: string;
  address: string;
  messengerUrl: string;
  itemDescription: string;
  itemType: string;
  estimatedPrice: number | null;
  note: string;
}) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_lead", {
    p_customer_name: input.customerName,
    p_phone: input.phone || null,
    p_address: input.address || null,
    p_messenger_url: input.messengerUrl || null,
    p_item_description: input.itemDescription,
    p_item_type: input.itemType || null,
    p_estimated_price: input.estimatedPrice,
    p_note: input.note || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/leads");
  return {};
}

export async function rejectLead(leadId: string, reason: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_lead", {
    p_lead_id: leadId,
    p_reason: reason || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/leads");
  return {};
}
