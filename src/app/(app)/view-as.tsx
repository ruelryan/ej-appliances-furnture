"use client";

import { usePathname } from "next/navigation";
import { PREVIEWABLE } from "@/lib/preview";
import type { Role } from "@/lib/supabase/server";

const ROLE_LABEL = (r: Role) =>
  PREVIEWABLE.find((p) => p.value === r)?.label ?? r;

/**
 * The owner's "view as" control, plus the banner shown while a preview runs.
 *
 * Uses <details> rather than React state so the menu costs no hydration beyond
 * the pathname hook, and closes on Escape for free. Every entry is a plain
 * link to a GET route, because writes are blocked while previewing.
 */
export function ViewAs({
  previewing,
  role,
}: {
  previewing: boolean;
  role: Role;
}) {
  const path = usePathname();
  const back = `&back=${encodeURIComponent(path)}`;

  if (previewing) {
    // Naming the role here, not just in the banner: the header is sticky and
    // the banner is not, so once you scroll this is the only thing still
    // saying that what you are looking at is not your own account.
    return (
      <a
        href={`/api/preview?exit=1${back}`}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-card border border-warning/40 bg-warning-bg px-2.5 text-micro font-semibold text-warning hover:bg-warning/10"
      >
        <span className="max-sm:hidden">Viewing as {ROLE_LABEL(role)} —</span>
        <span className="sm:hidden">{ROLE_LABEL(role)} —</span> Exit
      </a>
    );
  }

  return (
    <details className="relative">
      <summary className="inline-flex min-h-10 cursor-pointer list-none items-center rounded-card border border-line px-2.5 text-xs text-ink hover:bg-surface">
        View as
      </summary>
      <div className="absolute right-0 z-30 mt-1 w-52 overflow-hidden rounded-card border border-line bg-white shadow-xl">
        <p className="border-b border-line px-3 py-2 text-micro text-muted">
          See their screen. Data stays yours.
        </p>
        {PREVIEWABLE.map((r) => (
          <a
            key={r.value}
            href={`/api/preview?role=${r.value}${back}`}
            className="block px-3 py-2.5 text-sm text-ink hover:bg-surface"
          >
            {r.label}
          </a>
        ))}
        <a
          href="/admin/access"
          className="block border-t border-line px-3 py-2.5 text-sm font-medium text-brand hover:bg-surface"
        >
          What each role can access
        </a>
      </div>
    </details>
  );
}

/** The always-visible reminder that what is on screen is not the real thing. */
export function PreviewBanner({ role }: { role: Role }) {
  return (
    <div className="border-b border-warning/40 bg-warning-bg px-4 py-2 text-center text-xs text-warning">
      <span className="font-semibold">Viewing as {ROLE_LABEL(role)}</span>
      {" — layout only, and read-only. The rows are still yours, so this does "}
      {"not show what they can read. "}
      <a href="/admin/access" className="underline">
        See what they can access
      </a>
    </div>
  );
}
