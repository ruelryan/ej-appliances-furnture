import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { PREVIEW_COOKIE, isPreviewable } from "@/lib/preview";

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
  /** Set only while an owner is previewing another role. `role` above is then
   *  the PREVIEWED role — that is the point, so every existing role check in
   *  the app reacts without being touched. `realRole` is who you actually are. */
  previewing?: boolean;
  realRole?: Role;
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

// The signed-in user's TRUE profile, ignoring any "view as" preview. Use this
// anywhere the answer must be about who the person really is — starting the
// preview itself, and deciding whether to offer it at all.
export async function getRealProfile(): Promise<Profile | null> {
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

// Returns the signed-in user's profile, or null if not authenticated/active.
//
// If a real owner has a "view as" preview running, the returned `role` is the
// PREVIEWED one. That is deliberate: every role check already written in this
// app — nav filtering, the /analytics and /admin redirects, canPostPayments —
// then reacts correctly with no change at any call site. The preview can only
// ever downgrade, because only an owner may start one and owner is the top
// role. Writes are refused in middleware.ts while it is running.
export async function getProfile(): Promise<Profile | null> {
  const profile = await getRealProfile();
  if (!profile) return null;
  if (profile.role !== "owner") return profile;

  const cookieStore = await cookies();
  const as = cookieStore.get(PREVIEW_COOKIE)?.value;
  if (!isPreviewable(as)) return profile;

  return { ...profile, role: as, previewing: true, realRole: profile.role };
}
