import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";
import { topicsFor } from "./topics";

export const dynamic = "force-dynamic";

// The staff manual hub. Topics are filtered to the viewer's role, the same
// way nav links are — an agent never sees the collections page, so they
// never see its manual either. Reached from the top bar, not a nav tab
// (the mobile tab bar is full — same call as /collections/sop).

export default async function HelpPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const topics = topicsFor(profile.role);
  const groups = [...new Set(topics.map((t) => t.group))];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">How to use the app</h1>
        <p className="mt-1 text-sm text-muted">
          Short guides for everything you do here. Pick a topic.
        </p>
      </div>

      {groups.map((g) => (
        <div key={g}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            {g}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {topics
              .filter((t) => t.group === g)
              .map((t) => (
                <Link
                  key={t.slug}
                  href={`/help/${t.slug}`}
                  className="rounded-card border border-line bg-white p-4 hover:border-brand hover:bg-brand/5"
                >
                  <div className="font-display font-semibold text-ink">
                    {t.title}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">{t.sub}</div>
                </Link>
              ))}
          </div>
        </div>
      ))}

      <p className="text-xs text-muted">
        Not answered here? Ask the admin or the owner — and if the same
        question keeps coming up, tell the owner so this manual gets a page
        for it.
      </p>
    </div>
  );
}
