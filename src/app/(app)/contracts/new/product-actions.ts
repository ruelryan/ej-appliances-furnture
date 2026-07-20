"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface ProductHit {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  price: number | null;
  on_hand: number;
  review_status: string;
  storage_path: string | null;
  score: number;
}

/**
 * Typeahead over the catalogue. Goes through the search_products RPC rather
 * than PostgREST because ordering by word_similarity() cannot be expressed as
 * a REST filter.
 */
export async function searchProducts(term: string): Promise<ProductHit[]> {
  const q = term.trim();
  if (q.length < 2) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_products", { p_query: q });
  if (error) return [];
  return (data ?? []) as ProductHit[];
}

/**
 * Adds an item that is not in the catalogue, from inside the contract form.
 * The product is created FIRST because the photo's storage path is keyed by
 * product id, and the contract is never blocked on this — the item is flagged
 * for review afterwards and a task is raised for the admin by the RPC.
 */
export async function createProductForContract(input: {
  name: string;
  category: string;
  price: number | null;
  description: string;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_product_for_contract", {
    p_name: input.name,
    p_category: input.category || null,
    p_price: input.price,
    p_description: input.description || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/products");
  return { product: data as { id: string; sku: string; name: string; price: number | null } };
}

/** Uploads a already-downscaled photo and records its perceptual hash. */
export async function uploadProductPhotoWithHash(
  productId: string,
  formData: FormData,
  hash: string
) {
  const supabase = await createClient();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "No photo selected." };
  if (!file.type.startsWith("image/")) return { error: "Please choose an image file." };
  if (file.size > 5 * 1024 * 1024) return { error: "Image must be 5 MB or smaller." };

  const path = `${productId}/${crypto.randomUUID()}.jpg`;
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
    // best-effort cleanup so a failed insert does not orphan the object
    await supabase.storage.from("product-photos").remove([path]);
    return { error: error.message };
  }

  // Separate RPC, not a direct update: product_photos has a SELECT policy only,
  // so a table write would be silently swallowed by RLS. A missing hash just
  // means this photo cannot be compared visually — not worth failing the upload.
  if (hash && /^[01]{64}$/.test(hash)) {
    await supabase.rpc("set_product_photo_hash", {
      p_storage_path: path,
      p_dhash: hash,
    });
  }

  revalidatePath("/products");
  return {};
}
