// "View as" — let the owner see the app the way a member of staff sees it.
//
// WHAT THIS IS AND IS NOT. Permissions in this app live in two layers: the UI
// decides which links and buttons exist, and Postgres RLS decides which ROWS
// come back, keyed on auth.uid(). A preview can reproduce the first layer
// faithfully. It cannot reproduce the second — the database still sees the
// owner, so the owner sees the owner's rows in the other role's layout.
//
// That distinction is the whole reason /admin/access exists beside this: the
// honest answer to "what can Roger actually read" is the RLS matrix, not this
// preview. The banner says so on every screen, because a preview that looked
// authoritative about data would be worse than no preview at all.
//
// Safety properties:
//   1. Only a real owner can start a preview (checked against the DB role,
//      never against the previewed one).
//   2. It can only ever DOWNGRADE. The owner is the top role, so every target
//      is a downgrade — there is no path here that grants anything.
//   3. It is read-only. middleware.ts refuses every non-GET request while the
//      cookie is set, which covers all server actions and route handlers in
//      one place rather than relying on ~30 individual guards.

import type { Role } from "@/lib/supabase/server";

export const PREVIEW_COOKIE = "eandj_view_as";

/** Roles an owner may preview. Deliberately excludes `owner` (that is "exit")
 *  and legacy `staff` (no accounts hold it). */
export const PREVIEWABLE: { value: Role; label: string }[] = [
  { value: "admin", label: "Admin assistant" },
  { value: "collector", label: "Collector" },
  { value: "sales_agent", label: "Sales agent" },
  { value: "delivery", label: "Delivery" },
];

export function isPreviewable(v: string | undefined | null): v is Role {
  return !!v && PREVIEWABLE.some((r) => r.value === v);
}
