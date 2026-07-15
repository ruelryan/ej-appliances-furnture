"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home", icon: "🏠", ownerOnly: false },
  { href: "/contracts", label: "Contracts", icon: "📄", ownerOnly: false },
  { href: "/payments", label: "Payments", icon: "💵", ownerOnly: false },
  { href: "/collections", label: "Collect", icon: "📢", ownerOnly: false },
  { href: "/customers", label: "Customers", icon: "👥", ownerOnly: false },
  { href: "/analytics", label: "Analytics", icon: "📊", ownerOnly: true },
  { href: "/admin", label: "Admin", icon: "⚙️", ownerOnly: true },
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

  if (variant === "sidebar") {
    return (
      <div className="flex flex-col gap-1">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
              isActive(l.href)
                ? "bg-sky-100 font-semibold text-sky-900 dark:bg-sky-900 dark:text-sky-100"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            <span>{l.icon}</span>
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
          className={`flex flex-col items-center gap-0.5 py-2 text-[10px] ${
            isActive(l.href)
              ? "font-semibold text-sky-800 dark:text-sky-300"
              : "text-slate-500 dark:text-slate-400"
          }`}
        >
          <span className="text-lg leading-none">{l.icon}</span>
          {l.label}
        </Link>
      ))}
    </div>
  );
}
