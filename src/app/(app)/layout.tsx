import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
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
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      {/* Top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <Link href="/" className="text-lg font-bold text-sky-900 dark:text-sky-300">
          E &amp; J
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {profile.full_name}
            {isOwner && (
              <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                OWNER
              </span>
            )}
          </span>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl">
        {/* Desktop sidebar */}
        <aside className="sticky top-[53px] hidden h-[calc(100dvh-53px)] w-48 shrink-0 border-r border-slate-200 p-3 md:block dark:border-slate-800">
          <NavLinks isOwner={isOwner} variant="sidebar" />
        </aside>

        {/* Main content — bottom padding clears the mobile tab bar */}
        <main className="w-full min-w-0 p-4 pb-24 md:pb-8">{children}</main>
      </div>

      {/* Mobile bottom tabs */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden dark:border-slate-800 dark:bg-slate-900">
        <NavLinks isOwner={isOwner} variant="tabs" />
      </nav>
    </div>
  );
}
