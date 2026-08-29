# Roles and Permissions

The app has five business roles plus one legacy value, enforced in three layers that must not be confused: **Postgres RLS and RPC guards are the enforcement** (a request that shouldn't succeed fails in SQL no matter what the UI shows), **page-level redirects** keep people off screens that aren't for them, and **nav-link allowlists** merely tidy the menu. This document describes each role, the actual per-route gates as implemented in the `page.tsx` files, the SQL helpers and their TypeScript mirror, and the user lifecycle. The SQL side (policies and RPC guards table-by-table) is detailed in [database.md](database.md); the auth flow itself is in [architecture.md](architecture.md).

## The roles

Defined by the CHECK constraint on `profiles.role` (migration 0011) and the `Role` union in `src/lib/supabase/server.ts`:

| Role | Person (2026-08) | What it is for |
|---|---|---|
| `owner` | Ruel Ryan Rosal, Elvira Rosal | Everything. Sole access to analytics, user management, DTR settings, payroll finalization, 13th-month, contract editing, voiding payments, closing contracts, repossession stages. **There are two owners** (Elvira is a co-owner of the business, promoted from `admin` on 2026-08-06) — nothing in the schema or the app selects "the" owner row, and `is_owner()` matches on `auth.uid()`, so the role is safely multi-holder. Keep it that way. |
| `admin` | Analyn Clemente | The admin assistant. Posts payments and receipts, creates contracts, posts collectors' logged collections into payments (or links them to a payment already recorded — `link_collection_payment`), records cash remittances from collectors, manages products/deliveries/suppliers/leads, edits customer links and addresses. Everywhere SQL says `can_post_payments()`, admin qualifies alongside owner. |
| `collector` | Roger Dasal | Works an assigned, priority-ordered worklist; logs collection visits (`log_collection`) which are NOT payments until an owner/admin posts them; requests cash advances; may tag GPS/landmarks for customers on their own worklist. Sees their own remittance balance but **cannot record or cancel one** — the office receives the cash, so the office records it. **Never posts payments** — that is enforced in `record_payment` itself. Sees only contracts assigned to them. |
| `sales_agent` | (none currently) | Restricted read-only: their own contracts, commissions, and the customers tied to their own deals. May submit leads. Cannot see other customers' PII (RLS on `customers` narrows for this role specifically). |
| `delivery` | (none currently) | The delivery queue: sees all contracts (needed for fulfilment), marks availability and delivery, links products. |
| `staff` | legacy | The pre-0011 catch-all, migrated to `admin`; still permitted by the CHECK constraint, but **no longer treated as a payment-poster** — `canPostPayments` dropped it in the 2026-08-05 cleanup to match `can_post_payments()` in SQL, which never included it. No account holds this role. Not offered in the /admin role picker. |

## Per-route access

These are the gates as actually written in each `page.tsx` (verified against the source, not the nav). "Redirect" means the page checks `getProfile()` and calls `redirect()` before rendering.

| Route | owner | admin (+legacy staff) | collector | sales_agent | delivery | Gate in code |
|---|---|---|---|---|---|---|
| `/` (dashboard) | yes (owner board) | yes (admin board) | redirected → `/collections` | redirected → `/commissions` | redirected → `/deliveries` | `(app)/page.tsx` role redirects |
| `/admin/access` | yes | – | – | – | – | `getRealProfile()` role !== owner → `/` |
| `/api/preview` | yes | – | – | – | – | `getRealProfile()` role !== owner → redirect `/` |
| `/analytics` | yes | – | – | – | – | `role !== "owner"` → `/` |
| `/admin` | yes | – | – | – | – | `role !== "owner"` → `/` |
| `/dtr/settings` | yes | – | – | – | – | `role !== "owner"` → `/` |
| `/payroll/13th-month` | yes | – | – | – | – | `role !== "owner"` → `/` |
| `/contracts/[id]/edit` | yes | – | – | – | – | `role !== "owner"` → `/contracts/[id]` |
| `/products`, `/products/review` | yes | yes | – | – | – | owner/admin/staff (review uses `canPostPayments`) → else `/` |
| `/collections`, `/collections/report`, `/collections/remittances`, `/collections/sop` | yes | yes | yes | – | – | collector or owner/admin/staff → else `/` |
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
  return role === "owner" || role === "admin";
}
export function isOwnerRole(role: Role): boolean;
export async function getProfile(): Promise<Profile | null>; // null unless the profile exists AND is active
```

`canPostPayments` mirrors `can_post_payments()` exactly. It used to also include legacy `staff` as a transition safety, which made the two disagree: a staff user was routed to the full admin board and every button on it errored, because the RPCs refuse them. 0011 migrated every staff row to `admin` and `/admin` will not assign the role, so the asymmetry protected nobody — it was removed (0032-era cleanup). `staff` stays in the `Role` union because the `profiles` CHECK constraint still permits the value; it now carries **no capabilities**. The nav allowlists in `nav-links.tsx` still list it, but those only decide which links are drawn.

The same commit replaced eight hand-typed `owner || admin || staff` triples with calls to `canPostPayments`, so there is one definition to keep in step with SQL rather than nine.

### Print pages carry their own gate

`src/app/print/*` renders outside the authenticated shell and `print/layout.tsx` has no auth logic, so **every print page must gate itself**. Two of them (`amendment`, `demand-letter`) gate on `canPostPayments` because *document-generation authority* is not something RLS expresses — RLS scopes which contracts you can read, not which documents you may produce and serve. The other six (`payslip`, `commission-statement`, `dtr`, `contract`, `customer-card`, `receipt`) require an active profile via `getProfile()`; RLS decides which rows come back, and the gate is what stops a deactivated account with a still-valid cookie from rendering anything.

## User lifecycle

- **Creation** — owner-only, on `/admin`. The server action (`src/app/(app)/admin/actions.ts`) uses the service-role client to call `auth.admin.createUser` (email pre-confirmed, password ≥ 8 chars); the `handle_new_user` trigger creates the `profiles` row, then the action sets the requested role and full name. Assignable roles exclude legacy `staff`; an unrecognized role falls back to `collector` (least privilege).
- **No self-signup.** The login page only signs in; `middleware.ts` sends every unauthenticated request there.
- **Role changes** — owner-only on `/admin` (`setUserRole`); an owner cannot change their own role.
- **Deactivation** — the `active` flag, toggled on `/admin` (`setUserActive`; owners cannot deactivate themselves). Deactivation is the lock: `getProfile()` returns null for an inactive profile, and every SQL helper requires `active`, so an inactive user's session can read nothing and call nothing even before it expires. Deletion is not offered in the UI (the four test accounts were hard-deleted by hand in July 2026).
- **Password change** — self-service on `/account`, which re-verifies the current password via `signInWithPassword` before calling `auth.updateUser`.

## "View as" — the owner's role preview

An owner can preview the app as `admin`, `collector`, `sales_agent` or `delivery` from the top bar. It exists so the owner can answer "what does Analyn actually see?" without asking her to hand over her phone.

**It reproduces one of the two enforcement layers, and only one.** `getProfile()` returns the *previewed* role, so everything driven by role in TypeScript reacts correctly with no call site changed: nav filtering, the `/analytics` and `/admin` redirects, `canPostPayments`, every `role === "owner"` check. What it cannot reproduce is RLS — Postgres still identifies the session by the owner's `auth.uid()`, so the **rows are still the owner's**. The preview shows their screen holding your data.

That gap is why `/admin/access` ships beside it: the honest answer to "what can a collector read" is the RLS matrix, not the preview. The banner says so on every screen, because a preview that looked authoritative about data would answer a privacy question wrongly.

Implementation notes that matter if you touch this:

- **`getRealProfile()`** is the escape hatch for code that must know who the person really is. `/api/preview` and `/admin/access` both use it — the previewed role must never get a say in the preview itself.
- **It can only downgrade.** Only a real owner may start one, and owner is the top role, so every target is a reduction. There is no path here that grants anything.
- **Read-only is enforced in `middleware.ts`, not by hiding buttons.** Hiding is insufficient: the previewed role's own buttons would still write for real, because RLS sees the owner and permits it. Server actions and route handlers are all non-GET, so refusing non-GET while the cookie is set covers every write path at one point instead of ~30 guards.
- **Entering and leaving is a GET route** (`/api/preview?role=…` / `?exit=1`) precisely because of the rule above — if the exit were a POST the owner would be sealed inside the preview.
- **Sign-out is a POST**, so it is swapped for "Exit preview" while previewing rather than left as a dead button.
- The cookie expires after an hour, so a forgotten preview does not quietly hide Analytics from the owner the next morning.
