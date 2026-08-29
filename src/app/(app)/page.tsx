import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";
import { OwnerBoard } from "./dashboard/owner-board";
import { AdminBoard } from "./dashboard/admin-board";

// Every figure on this page is time-dependent, so it must never be cached.
// The old dashboard was missing this while every comparable page had it.
export const dynamic = "force-dynamic";

/**
 * The dashboard is a role router.
 *
 * Three roles already had a focused landing elsewhere; `collector` now joins
 * them. Roger's home is /collections, which ALREADY shows assigned accounts,
 * cash today, online today and cash on hand. A collector board here would have
 * been a second copy of those four tiles to keep in step, and sent him one tap
 * further from the worklist he actually works.
 */
export default async function DashboardPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  if (profile.role === "sales_agent") redirect("/commissions");
  if (profile.role === "delivery") redirect("/deliveries");
  if (profile.role === "collector") redirect("/collections");

  const greeting = profile.full_name.split(" ")[0];

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-ink">
        {profile.role === "owner" ? `Good day, ${greeting}` : "Today"}
      </h1>
      {profile.role === "owner" ? (
        <OwnerBoard />
      ) : (
        <AdminBoard profileId={profile.id} />
      )}
    </div>
  );
}
