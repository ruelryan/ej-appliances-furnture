"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/supabase/server";

// Inline stroke icons (24×24 viewBox, currentColor) — no icon library.
const ICONS: Record<string, React.ReactNode> = {
  home: (
    <path d="M3 10.5 12 3l9 7.5M5.5 9.5V21h13V9.5" />
  ),
  dtr: (
    <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3.5 2" />
  ),
  contracts: (
    <path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5" />
  ),
  payments: (
    <path d="M3 7h18v10H3zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM6.5 12h.01M17.5 12h.01" />
  ),
  collect: (
    <path d="M4 11v3l2 .5V21h3v-6l11 4V4L6 8.5H4a1 1 0 0 0-1 1v.5" />
  ),
  customers: (
    <path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 20c0-3 2.5-5 6-5s6 2 6 5M16 4.5a3.5 3.5 0 0 1 0 6.6M17.5 15.2c2.1.6 3.5 2.2 3.5 4.8" />
  ),
  analytics: (
    <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />
  ),
  admin: (
    <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8 4-1.8-.5a6.3 6.3 0 0 0-.6-1.5l.9-1.6-1.9-1.9-1.6.9a6.3 6.3 0 0 0-1.5-.6L13 5h-2l-.5 1.8a6.3 6.3 0 0 0-1.5.6l-1.6-.9-1.9 1.9.9 1.6a6.3 6.3 0 0 0-.6 1.5L4 12l1.8.5c.1.5.3 1 .6 1.5l-.9 1.6 1.9 1.9 1.6-.9c.5.3 1 .5 1.5.6L11 19h2l.5-1.8c.5-.1 1-.3 1.5-.6l1.6.9 1.9-1.9-.9-1.6c.3-.5.5-1 .6-1.5L20 12Z" />
  ),
  commissions: (
    <path d="M19 5 5 19M8 6.5A1.5 1.5 0 1 1 5 6.5a1.5 1.5 0 0 1 3 0ZM19 17.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
  ),
  leads: (
    <path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 20c0-3 2.5-5 6-5s6 2 6 5M18 8v6M21 11h-6" />
  ),
  deliveries: (
    <path d="M3 6.5h11v9H3zM14 9.5h4l3 3v3h-7zM7.5 18.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3ZM17.5 18.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
  ),
  tasks: (
    <path d="M9 4h6v2H9zM7 6h10v14H7zM9.5 12.5 11 14l3.5-4" />
  ),
  products: (
    <path d="M3.5 7 12 3l8.5 4-8.5 4zM3.5 7v10l8.5 4M20.5 7v10l-8.5 4M12 11v10" />
  ),
};

function NavIcon({ name, className }: { name: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

// `roles` omitted = visible to every authenticated role.
// RLS scopes the *content* of shared pages (a collector's Contracts list
// shows only assigned contracts); this list only controls nav visibility.
type NavLink = {
  href: string;
  label: string;
  icon: string;
  roles?: Role[];
};

const LINKS: NavLink[] = [
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

function visibleTo(role: Role) {
  return (l: NavLink) => !l.roles || l.roles.includes(role);
}

export function NavLinks({
  role,
  taskCount = 0,
  variant,
}: {
  role: Role;
  taskCount?: number;
  variant: "sidebar" | "tabs";
}) {
  const pathname = usePathname();
  const links = LINKS.filter(visibleTo(role));
  const badgeFor = (href: string) => (href === "/tasks" ? taskCount : 0);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  // One active-state rule for both variants: brand text (+ tinted bg where
  // there's room), muted otherwise.
  if (variant === "sidebar") {
    return (
      <div className="flex flex-col gap-1">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`flex items-center gap-2.5 rounded-card px-3 py-2 text-sm ${
              isActive(l.href)
                ? "bg-brand/10 font-semibold text-brand"
                : "text-ink hover:bg-white"
            }`}
          >
            <NavIcon name={l.icon} className="h-[18px] w-[18px]" />
            {l.label}
            {badgeFor(l.href) > 0 && (
              <span className="ml-auto rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {badgeFor(l.href)}
              </span>
            )}
          </Link>
        ))}
      </div>
    );
  }

  // Mobile tabs: cap at 6 (DTR clock-in must be one tap on a phone);
  // pages beyond the cap remain reachable from the dashboard. `links` is
  // already role-filtered above.
  const tabLinks = links.slice(0, 6);

  return (
    <div className="grid grid-cols-6">
      {tabLinks.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`relative flex flex-col items-center gap-1 py-2 text-[10px] ${
            isActive(l.href) ? "font-semibold text-brand" : "text-muted"
          }`}
        >
          <NavIcon name={l.icon} className="h-[22px] w-[22px]" />
          {badgeFor(l.href) > 0 && (
            <span className="absolute right-1/2 top-1 -mr-3 rounded-full bg-danger px-1.5 text-[9px] font-semibold text-white">
              {badgeFor(l.href)}
            </span>
          )}
          {l.label}
        </Link>
      ))}
    </div>
  );
}
