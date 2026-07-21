import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";
import { BackLink } from "@/components/back-link";
import { HELP_TOPICS } from "../topics";

export const dynamic = "force-dynamic";

export default async function HelpTopicPage({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const { topic } = await params;
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const t = HELP_TOPICS.find((x) => x.slug === topic);
  if (!t) notFound();
  // A topic outside the viewer's role goes back to their own hub rather
  // than 404 — the URL may have been shared by a colleague with more access.
  if (t.roles && !t.roles.includes(profile.role)) redirect("/help");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
          <BackLink /> {t.title}
        </h1>
        <p className="mt-1 text-sm text-muted">{t.sub}</p>
      </div>

      {t.body}

      <p className="text-xs text-muted">
        <Link href="/help" className="hover:text-ink hover:underline">
          ← All help topics
        </Link>
      </p>
    </div>
  );
}
