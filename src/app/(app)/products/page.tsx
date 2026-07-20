import { redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { SectionCard } from "@/components/section-card";
import { StatTile } from "@/components/stat-tile";
import { ProductCard, type Product } from "./product-card";
import { NewProductForm } from "./new-product-form";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  const canManage =
    profile.role === "owner" || profile.role === "admin" || profile.role === "staff";
  if (!canManage) redirect("/");

  const supabase = await createClient();
  const { data: products } = await supabase
    .from("products")
    .select("*, product_photos(id, storage_path, sort_order)")
    .order("name");

  const list = (products ?? []) as Product[];
  const active = list.filter((p) => p.active);
  const lowStock = active.filter((p) => p.on_hand <= 0).length;

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-ink">Products</h1>

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Products" value={String(active.length)} />
        <StatTile label="Out of stock" value={String(lowStock)} alert={lowStock > 0} />
        <StatTile label="With photos" value={String(active.filter((p) => (p.product_photos ?? []).length > 0).length)} />
      </div>

      <SectionCard title="Add a product">
        <NewProductForm />
      </SectionCard>

      <SectionCard title="Catalog" sub="Edit details, manage photos, and update stock.">
        {list.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No products yet.</p>
        ) : (
          <div className="space-y-3">
            {list.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
