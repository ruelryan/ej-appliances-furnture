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

// Structured address. Owner/admin only — the RPC validates the triple against
// ph_locations so a typo cannot invent a barangay and split an area in two.
export async function setCustomerAddress(
  customerId: string,
  input: {
    province: string;
    municipality: string;
    barangay: string;
    streetPurok: string;
    landmark: string;
  }
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_customer_address", {
    p_customer_id: customerId,
    p_province: input.province,
    p_municipality: input.municipality,
    p_barangay: input.barangay,
    p_street_purok: input.streetPurok,
    p_landmark: input.landmark,
  });
  if (error) return { error: error.message };
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/collections");
  return {};
}

// GPS + landmark are open to the COLLECTOR as well as owner/admin — the person
// standing at the door is the only one who can record either. The RPC restricts
// a collector to customers on their own worklist.
export async function tagCustomerGps(
  customerId: string,
  coords: { lat: number; lng: number; accuracy: number | null }
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("tag_customer_gps", {
    p_customer_id: customerId,
    p_lat: coords.lat,
    p_lng: coords.lng,
    p_accuracy_m: coords.accuracy,
  });
  if (error) return { error: error.message };
  revalidatePath("/collections");
  revalidatePath(`/customers/${customerId}`);
  return {};
}

export async function setCustomerLandmark(customerId: string, landmark: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_customer_landmark", {
    p_customer_id: customerId,
    p_landmark: landmark,
  });
  if (error) return { error: error.message };
  revalidatePath("/collections");
  revalidatePath(`/customers/${customerId}`);
  return {};
}
