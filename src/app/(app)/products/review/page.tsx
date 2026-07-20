import { redirect } from "next/navigation";
import { createClient, getProfile, canPostPayments } from "@/lib/supabase/server";
import { SectionCard } from "@/components/section-card";
import { BackLink } from "@/components/back-link";
import { ReviewItem, type Candidate, type PendingProduct } from "./review-item";

export const dynamic = "force-dynamic";

export default async function ProductReviewPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!canPostPayments(profile.role)) redirect("/");

  const supabase = await createClient();

  const { data: pending } = await supabase
    .from("products")
    .select("*, product_photos(id, storage_path, sort_order, dhash)")
    .eq("review_status", "pending")
    .order("created_at", { ascending: true });

  const items = (pending ?? []) as PendingProduct[];

  // One candidate query per pending item. Fine at this scale — the queue is
  // normally a handful of rows, and each returns at most 8 suspects.
  const candidates = new Map<string, Candidate[]>();
  for (const p of items) {
    const { data } = await supabase.rpc("find_duplicate_candidates", {
      p_product_id: p.id,
    });
    candidates.set(p.id, (data ?? []) as Candidate[]);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
          <BackLink /> Review new items
        </h1>
        <p className="mt-1 text-sm text-muted">
          Items added while writing a contract, before they have been checked
          against the catalog.
        </p>
      </div>

      {items.length === 0 ? (
        <SectionCard title="Queue" sub="Nothing waiting.">
          <p className="py-6 text-center text-sm text-muted">
            No new items to review. They appear here when someone adds an item
            from the contract form.
          </p>
        </SectionCard>
      ) : (
        items.map((p) => (
          <ReviewItem key={p.id} product={p} candidates={candidates.get(p.id) ?? []} />
        ))
      )}
    </div>
  );
}
