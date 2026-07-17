import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { LogoMark } from "@/components/logo";
import { NavLinks } from "./nav-links";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const isOwner = profile.role === "owner";

  return (
    <div className="min-h-dvh bg-surface">
      {/* Top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-white px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-brand">
            <LogoMark className="h-6 w-6" />
          </span>
          <span className="font-display text-lg font-semibold text-ink">
            E &amp; J
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/account" className="text-xs text-muted hover:text-ink hover:underline">
            {profile.full_name}
            {isOwner && (
              <span className="ml-1 rounded-full bg-warning-bg px-2 py-0.5 text-[10px] font-semibold text-warning">
                OWNER
              </span>
            )}
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-card border border-line px-2.5 py-1 text-xs text-ink hover:bg-surface"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl">
        {/* Desktop sidebar */}
        <aside className="sticky top-[53px] hidden h-[calc(100dvh-53px)] w-48 shrink-0 border-r border-line p-3 md:block">
          <NavLinks isOwner={isOwner} variant="sidebar" />
        </aside>

        {/* Main content — bottom padding clears the mobile tab bar */}
        <main className="w-full min-w-0 p-4 pb-24 md:pb-8">{children}</main>
      </div>

      {/* Mobile bottom tabs */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        <NavLinks isOwner={isOwner} variant="tabs" />
      </nav>
    </div>
  );
}
