"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Inline stroke icons (24×24 viewBox, currentColor) — no icon library.
const ICONS: Record<string, React.ReactNode> = {
  home: (
    <path d="M3 10.5 12 3l9 7.5M5.5 9.5V21h13V9.5" />
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

const LINKS = [
  { href: "/", label: "Home", icon: "home", ownerOnly: false },
  { href: "/contracts", label: "Contracts", icon: "contracts", ownerOnly: false },
  { href: "/payments", label: "Payments", icon: "payments", ownerOnly: false },
  { href: "/collections", label: "Collect", icon: "collect", ownerOnly: false },
  { href: "/customers", label: "Customers", icon: "customers", ownerOnly: false },
  { href: "/analytics", label: "Analytics", icon: "analytics", ownerOnly: true },
  { href: "/admin", label: "Admin", icon: "admin", ownerOnly: true },
];

export function NavLinks({
  isOwner,
  variant,
}: {
  isOwner: boolean;
  variant: "sidebar" | "tabs";
}) {
  const pathname = usePathname();
  const links = LINKS.filter((l) => isOwner || !l.ownerOnly);

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
          </Link>
        ))}
      </div>
    );
  }

  // Mobile tabs: cap at 5 for thumb reach; owner-only pages remain reachable
  // from the dashboard.
  const tabLinks = links.filter((l) => !l.ownerOnly).slice(0, 5);

  return (
    <div className="grid grid-cols-5">
      {tabLinks.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`flex flex-col items-center gap-1 py-2 text-[10px] ${
            isActive(l.href) ? "font-semibold text-brand" : "text-muted"
          }`}
        >
          <NavIcon name={l.icon} className="h-[22px] w-[22px]" />
          {l.label}
        </Link>
      ))}
    </div>
  );
}
