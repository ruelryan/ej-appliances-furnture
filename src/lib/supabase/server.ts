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
  | "staff"; // legacy; migrated to 'admin' in 0011, kept for safety

export interface Profile {
  id: string;
  full_name: string;
  role: Role;
  active: boolean;
}

// Capability helpers — mirror the SQL guards so UI gating matches RLS.
// owner + admin (and legacy staff) may post payments / create contracts.
export function canPostPayments(role: Role): boolean {
  return role === "owner" || role === "admin" || role === "staff";
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
