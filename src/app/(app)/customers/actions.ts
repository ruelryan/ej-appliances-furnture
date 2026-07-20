"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// The only write path for customer contact links. Guarded in SQL by
// can_post_payments() (0020) — owner/admin only, so a collector cannot
// repoint the group chat they are chased on.
export async function setCustomerLinks(
  customerId: string,
  input: { messengerUrl: string; collectionGcUrl: string }
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_customer_links", {
    p_customer_id: customerId,
    // '' clears a link; the RPC treats null as "leave unchanged", so always
    // send a string here — the form submits both fields together.
    p_messenger_url: input.messengerUrl,
    p_collection_gc_url: input.collectionGcUrl,
  });
  if (error) return { error: error.message };
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/collections");
  return {};
}
