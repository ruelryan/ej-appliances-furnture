# Roles and Permissions

The app has five business roles plus one legacy value, enforced in three layers that must not be confused: **Postgres RLS and RPC guards are the enforcement** (a request that shouldn't succeed fails in SQL no matter what the UI shows), **page-level redirects** keep people off screens that aren't for them, and **nav-link allowlists** merely tidy the menu. This document describes each role, the actual per-route gates as implemented in the `page.tsx` files, the SQL helpers and their TypeScript mirror, and the user lifecycle. The SQL side (policies and RPC guards table-by-table) is detailed in [database.md](database.md); the auth flow itself is in [architecture.md](architecture.md).

## The roles

Defined by the CHECK constraint on `profiles.role` (migration 0011) and the `Role` union in `src/lib/supabase/server.ts`:

| Role | Person (2026-07) | What it is for |
|---|---|---|
| `owner` | Ruel Ryan Rosal | Everything. Sole access to analytics, user management, DTR settings, payroll finalization, 13th-month, contract editing, voiding payments, closing contracts, repossession stages. |
| `admin` | Analyn Clemente | The admin assistant. Posts payments and receipts, creates contracts, posts collectors' logged collections into payments, manages products/deliveries/suppliers/leads, edits customer links and addresses. Everywhere SQL says `can_post_payments()`, admin qualifies alongside owner. |
| `collector` | Roger Dasal | Works an assigned, priority-ordered worklist; logs collection visits (`log_collection`) which are NOT payments until an owner/admin posts them; requests cash advances; may tag GPS/landmarks for customers on their own worklist. **Never posts payments** — that is enforced in `record_payment` itself. Sees only contracts assigned to them. |
| `sales_agent` | (none currently) | Restricted read-only: their own contracts, commissions, and the customers tied to their own deals. May submit leads. Cannot see other customers' PII (RLS on `customers` narrows for this role specifically). |
| `delivery` | (none currently) | The delivery queue: sees all contracts (needed for fulfilment), marks availability and delivery, links products. |
| `staff` | legacy | The pre-0011 catch-all, migrated to `admin`; kept in the CHECK constraint and in the TS `canPostPayments` during transition. Not offered in the /admin role picker. |

## Per-route access

These are the gates as actually written in each `page.tsx` (verified against the source, not the nav). "Redirect" means the page checks `getProfile()` and calls `redirect()` before rendering.

| Route | owner | admin (+legacy staff) | collector | sales_agent | delivery | Gate in code |
|---|---|---|---|---|---|---|
| `/` (dashboard) | yes | yes | yes | redirected → `/commissions` | redirected → `/deliveries` | `(app)/page.tsx` role redirects |
| `/analytics` | yes | – | – | – | – | `role !== "owner"` → `/` |
| `/admin` | yes | – | – | – | – | `role !== "owner"` → `/` |
| `/dtr/settings` | yes | – | – | – | – | `role !== "owner"` → `/` |
| `/payroll/13th-month` | yes | – | – | – | – | `role !== "owner"` → `/` |
| `/contracts/[id]/edit` | yes | – | – | – | – | `role !== "owner"` → `/contracts/[id]` |
| `/products`, `/products/review` | yes | yes | – | – | – | owner/admin/staff (review uses `canPostPayments`) → else `/` |
| `/collections`, `/collections/report`, `/collections/sop` | yes | yes | yes | – | – | collector or owner/admin/staff → else `/` |
| `/deliveries` | yes | yes | – | – | yes | delivery or owner/admin/staff → else `/` |
| `/commissions`, `/leads` | yes | yes | – | yes | – | owner/admin/staff or sales_agent → else `/` |
| `/api/export/[dataset]` | yes | – | – | – | – | `role !== "owner"` → 403 response |

### Routes with NO page-level role gate

This is the important nuance. The following routes check only that you are signed in (or not even that — some just render), and rely entirely on RLS to scope what rows come back:

`/payments`, `/payments/new`, `/customers`, `/customers/[id]`, `/contracts`, `/contracts/new`, `/contracts/[id]`, `/tasks`, `/tasks/[id]`, `/dtr`, `/payroll`, `/payroll/[id]`, `/account`

Verified in the source: none of these pages compares `profile.role` to decide whether to render (several don't even call `getProfile()` except to toggle owner-only buttons). So **any authenticated role can load `/payments`** — but a collector who does sees only payments on contracts assigned to them (the 0011 `payments_select` policy), and the void/record buttons they'd need are both hidden and, more importantly, backed by RPCs that raise. Likewise `/contracts` shows a collector only their assigned contracts and a sales agent only their own deals; `/payroll` shows staff only their own final slips; `/contracts/new` renders for anyone but `create_contract` refuses everyone except owner/admin. The nav allowlists in `nav-links.tsx` (e.g. Payments listed for owner/admin/staff only, DTR hidden from sales_agent, Customers hidden from collector) are **convenience only** — the file's own comment says so: RLS scopes the content of shared pages; the list only controls nav visibility.

Two consequences worth internalizing:

- Never "secure" a feature by hiding a link or adding a redirect. Add or verify the SQL guard first; the UI gate is decoration.
- Conversely, a missing redirect is not automatically a bug. `/dtr` for a sales_agent (not in its nav allowlist) just shows their own empty/own-only time records.

## SQL helpers and the TS mirror

The SQL guards (all `stable security definer`, keyed on `auth.uid()` and requiring `active`):

| SQL helper | True for | Introduced |
|---|---|---|
| `is_owner()` | owner | 0001 |
| `is_active_user()` | any active profile | 0001 |
| `can_post_payments()` | owner or admin | 0011 |
| `is_collector()`, `is_sales_agent()`, `is_delivery()` | that role | 0011 |
| `my_role()` | returns the role text (RLS on tasks, nav badge) | 0017 |
| `can_see_task(id)` | owner / task creator / assignee / assigned-team member | 0017 |

The TypeScript mirror lives in `src/lib/supabase/server.ts`:

```ts
export type Role = "owner" | "admin" | "collector" | "sales_agent" | "delivery" | "staff";
export function canPostPayments(role: Role): boolean {
  return role === "owner" || role === "admin" || role === "staff";
}
export function isOwnerRole(role: Role): boolean;
export async function getProfile(): Promise<Profile | null>; // null unless the profile exists AND is active
```

Note the deliberate asymmetry: the TS `canPostPayments` still includes legacy `staff` (a UI-side safety during the transition), while the SQL `can_post_payments()` accepts only owner/admin. Since all writes go through SQL, the SQL version is the one that decides.

## User lifecycle

- **Creation** — owner-only, on `/admin`. The server action (`src/app/(app)/admin/actions.ts`) uses the service-role client to call `auth.admin.createUser` (email pre-confirmed, password ≥ 8 chars); the `handle_new_user` trigger creates the `profiles` row, then the action sets the requested role and full name. Assignable roles exclude legacy `staff`; an unrecognized role falls back to `collector` (least privilege).
- **No self-signup.** The login page only signs in; `middleware.ts` sends every unauthenticated request there.
- **Role changes** — owner-only on `/admin` (`setUserRole`); an owner cannot change their own role.
- **Deactivation** — the `active` flag, toggled on `/admin` (`setUserActive`; owners cannot deactivate themselves). Deactivation is the lock: `getProfile()` returns null for an inactive profile, and every SQL helper requires `active`, so an inactive user's session can read nothing and call nothing even before it expires. Deletion is not offered in the UI (the four test accounts were hard-deleted by hand in July 2026).
- **Password change** — self-service on `/account`, which re-verifies the current password via `signInWithPassword` before calling `auth.updateUser`.
