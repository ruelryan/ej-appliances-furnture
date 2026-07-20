// Public URL for a product photo stored in the public `product-photos` bucket.
export function productPhotoUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-photos/${path}`;
}
