import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { LocationTree } from "@/components/address-fields";

/**
 * Loads ph_locations as province → municipality → barangays.
 *
 * MUST paginate: there are ~2,100 rows and PostgREST caps a read at 1,000. The
 * .order() is not cosmetic either — without a stable sort, .range() pages can
 * overlap and drop rows, which is exactly how an earlier verification script in
 * this project produced a phantom ₱32k discrepancy.
 */
export async function getLocationTree(): Promise<LocationTree> {
  const supabase = await createClient();
  const rows: Array<{ province: string; municipality: string; barangay: string }> = [];

  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("ph_locations")
      .select("province, municipality, barangay")
      .order("province")
      .order("municipality")
      .order("barangay")
      .range(from, from + 999);
    if (error || !data) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }

  const tree: LocationTree = {};
  for (const r of rows) {
    (tree[r.province] ??= {});
    (tree[r.province][r.municipality] ??= []).push(r.barangay);
  }
  return tree;
}
