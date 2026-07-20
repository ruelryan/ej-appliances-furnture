"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function revalidate() {
  revalidatePath("/products");
}

export async function createProduct(input: {
  name: string;
  category: string;
  price: number | null;
  defaultCost: number | null;
  description?: string;
}) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_product", {
    p_name: input.name,
    p_category: input.category || null,
    p_default_cost: input.defaultCost,
    p_price: input.price,
    p_description: input.description || null,
  });
  if (error) return { error: error.message };
  revalidate();
  return {};
}

export async function updateProduct(
  id: string,
  input: {
    name: string;
    category: string;
    price: number | null;
    defaultCost: number | null;
    active: boolean;
    description: string;
  }
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_product", {
    p_id: id,
    p_name: input.name,
    p_category: input.category || null,
    p_price: input.price,
    p_default_cost: input.defaultCost,
    p_active: input.active,
    p_description: input.description || null,
  });
  if (error) return { error: error.message };
  revalidate();
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
  revalidate();
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
  revalidate();
  return {};
}

export async function uploadProductPhoto(productId: string, formData: FormData) {
  const supabase = await createClient();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "No file selected." };
  if (!file.type.startsWith("image/")) return { error: "Please choose an image file." };
  if (file.size > 5 * 1024 * 1024) return { error: "Image must be 5 MB or smaller." };

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${productId}/${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from("product-photos")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return { error: upErr.message };

  const { error } = await supabase.rpc("add_product_photo", {
    p_product_id: productId,
    p_storage_path: path,
    p_sort_order: 0,
  });
  if (error) {
    // best-effort cleanup of the orphaned object
    await supabase.storage.from("product-photos").remove([path]);
    return { error: error.message };
  }
  revalidate();
  return {};
}

export async function deleteProductPhoto(photoId: string) {
  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc("delete_product_photo", { p_id: photoId });
  if (error) return { error: error.message };
  if (path) await supabase.storage.from("product-photos").remove([path as string]);
  revalidate();
  return {};
}
