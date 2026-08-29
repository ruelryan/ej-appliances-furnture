import type { Role } from "@/lib/supabase/server";

// Navigation data, deliberately in a module with NO "use client".
//
// nav-links.tsx is a client component, and a constant exported from one of
// those reaches the server as a client-reference proxy rather than as the
// value — the bug that took the Tasks page down for a month. Keeping the data
// here means the nav-coverage test can import it, and so could a server
// component later.
//
// `roles` omitted = visible to every authenticated role. RLS scopes the
// *content* of shared pages (a collector's Contracts list shows only assigned
// contracts); this list only controls nav visibility.

export type NavLink = {
  href: string;
  label: string;
  icon: string;
  roles?: Role[];
};

export const LINKS: NavLink[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/tasks", label: "Tasks", icon: "tasks" },
  { href: "/dtr", label: "DTR", icon: "dtr", roles: ["owner", "admin", "collector", "delivery", "staff"] },
  { href: "/contracts", label: "Contracts", icon: "contracts", roles: ["owner", "admin", "collector", "sales_agent", "delivery", "staff"] },
  { href: "/payments", label: "Payments", icon: "payments", roles: ["owner", "admin", "staff"] },
  { href: "/collections", label: "Collect", icon: "collect", roles: ["owner", "admin", "collector", "staff"] },
  { href: "/deliveries", label: "Deliveries", icon: "deliveries", roles: ["owner", "admin", "delivery", "staff"] },
  { href: "/products", label: "Products", icon: "products", roles: ["owner", "admin", "staff"] },
  { href: "/customers", label: "Customers", icon: "customers", roles: ["owner", "admin", "staff"] },
  { href: "/commissions", label: "Commissions", icon: "commissions", roles: ["owner", "admin", "staff", "sales_agent"] },
  { href: "/leads", label: "Leads", icon: "leads", roles: ["owner", "admin", "staff", "sales_agent"] },
  { href: "/analytics", label: "Analytics", icon: "analytics", roles: ["owner"] },
  { href: "/admin", label: "Admin", icon: "admin", roles: ["owner"] },
];

export function visibleTo(role: Role) {
  return (l: NavLink) => !l.roles || l.roles.includes(role);
}

/**
 * The four mobile tabs per role; everything else that role can see goes into
 * the More sheet.
 *
 * Chosen per role rather than sliced off the front of LINKS. The slice had two
 * faults: it stranded everything past the sixth entry with no mobile route at
 * all (seven whole sections, for the owner), and it could not express that DTR
 * deserves a tab for the people who clock in and not for the owner, who does
 * not.
 *
 * Every href here must be visible to that role — nav-coverage.test.ts fails
 * the build otherwise, because a typo would silently strand somebody and there
 * is no staging environment to notice.
 */
export const TAB_HREFS: Record<Role, string[]> = {
  owner: ["/", "/contracts", "/collections", "/payments"],
  admin: ["/", "/contracts", "/collections", "/payments"],
  staff: ["/", "/contracts", "/collections", "/payments"],
  collector: ["/", "/collections", "/contracts", "/dtr"],
  sales_agent: ["/", "/leads", "/commissions", "/contracts"],
  delivery: ["/", "/deliveries", "/contracts", "/dtr"],
};

export const ALL_ROLES: Role[] = [
  "owner",
  "admin",
  "collector",
  "sales_agent",
  "delivery",
  "staff",
];
