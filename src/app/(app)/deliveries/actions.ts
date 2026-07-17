"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function revalidate(contractId?: string) {
  revalidatePath("/deliveries");
  if (contractId) revalidatePath(`/contracts/${contractId}`);
}

export async function setDeliveryAvailability(
  deliveryId: string,
  inStock: boolean,
  contractId?: string
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_delivery_availability", {
    p_delivery_id: deliveryId,
    p_in_stock: inStock,
  });
  if (error) return { error: error.message };
  revalidate(contractId);
  return {};
}

export async function recordSupplierOrder(
  deliveryId: string,
  input: { supplierId: string | null; cost: number; orderedAt: string; paidAt: string },
  contractId?: string
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_supplier_order", {
    p_delivery_id: deliveryId,
    p_supplier_id: input.supplierId,
    p_cost: input.cost,
    p_ordered_at: input.orderedAt || null,
    p_paid_at: input.paidAt || null,
  });
  if (error) return { error: error.message };
  revalidate(contractId);
  return {};
}

export async function recordSupplierInvoice(
  deliveryId: string,
  input: { invoiceRef: string; receivedAt: string },
  contractId?: string
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_supplier_invoice", {
    p_delivery_id: deliveryId,
    p_invoice_ref: input.invoiceRef || null,
    p_received_at: input.receivedAt || null,
  });
  if (error) return { error: error.message };
  revalidate(contractId);
  return {};
}

export async function markDelivered(
  deliveryId: string,
  note: string,
  contractId?: string
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_delivered", {
    p_delivery_id: deliveryId,
    p_note: note || null,
  });
  if (error) return { error: error.message };
  revalidate(contractId);
  return {};
}

export async function addSupplier(input: {
  name: string;
  contact: string;
  address: string;
  note: string;
}) {
  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").insert({
    name: input.name,
    contact: input.contact || null,
    address: input.address || null,
    note: input.note || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/deliveries");
  return {};
}

// ── Inventory (Stage 3b) ──────────────────────────────────────
export async function createProduct(input: {
  name: string;
  category: string;
  defaultCost: number | null;
}) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_product", {
    p_name: input.name,
    p_category: input.category || null,
    p_default_cost: input.defaultCost,
  });
  if (error) return { error: error.message };
  revalidatePath("/deliveries");
  return {};
}

export async function restockProduct(productId: string, qty: number, note: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("restock_product", {
    p_id: productId,
    p_qty: qty,
    p_note: note || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/deliveries");
  return {};
}

export async function adjustStock(productId: string, delta: number, note: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("adjust_stock", {
    p_id: productId,
    p_delta: delta,
    p_note: note || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/deliveries");
  return {};
}

export async function setDeliveryProduct(
  deliveryId: string,
  productId: string | null,
  contractId?: string
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_delivery_product", {
    p_delivery_id: deliveryId,
    p_product_id: productId,
  });
  if (error) return { error: error.message };
  revalidate(contractId);
  return {};
}
