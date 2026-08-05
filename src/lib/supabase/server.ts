import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — middleware refreshes sessions.
          }
        },
      },
    }
  );
}

export type Role =
  | "owner"
  | "admin"
  | "collector"
  | "sales_agent"
  | "delivery"
  // Legacy. 0011 migrated every staff row to admin and /admin will not assign
  // it, but the value stays in the profiles CHECK constraint, so it stays in
  // the union. It now carries NO capabilities — canPostPayments excludes it,
  // matching can_post_payments() in SQL. The nav allowlists still list it, but
  // those only decide which links are drawn.
  | "staff";

export interface Profile {
  id: string;
  full_name: string;
  role: Role;
  active: boolean;
}

// Capability helpers — mirror the SQL guards so UI gating matches RLS.
//
// This must agree with can_post_payments() in 0011, which accepts owner and
// admin ONLY. It used to include legacy 'staff' as a transition safety, which
// made the two disagree: a staff user was shown the full admin board and every
// button on it errored, because the RPCs refuse them. There are no staff
// accounts left — the 0011 migration moved them all to admin, and /admin will
// not assign the role — so the asymmetry was protecting nobody.
export function canPostPayments(role: Role): boolean {
  return role === "owner" || role === "admin";
}
export function isOwnerRole(role: Role): boolean {
  return role === "owner";
}

// Returns the signed-in user's profile, or null if not authenticated/active.
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, role, active")
    .eq("id", user.id)
    .single();

  if (!data || !data.active) return null;
  return data as Profile;
}
