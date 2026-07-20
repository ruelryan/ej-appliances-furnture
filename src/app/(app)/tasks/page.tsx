import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { fmtDateShort } from "@/lib/format";
import { SectionCard } from "@/components/section-card";
import { NewTaskDialog, TEAM_OPTIONS } from "./new-task-dialog";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  open: "border border-line bg-white text-muted",
  in_progress: "bg-warning-bg text-warning",
  done: "bg-positive/10 text-positive",
  cancelled: "bg-danger-bg text-danger",
};
const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};
const PRIORITY_RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };
const teamLabel = (r: string) =>
  TEAM_OPTIONS.find((t) => t.value === r)?.label ?? r;

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  const { tab = "me" } = await searchParams;
  const isOwner = profile.role === "owner";

  const supabase = await createClient();
  const [{ data: tasks }, { data: people }] = await Promise.all([
    supabase
      .from("tasks")
      .select("*, contract:contracts(contract_no)")
      .order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, full_name, role")
      .eq("active", true)
      .order("full_name"),
  ]);

  const peopleList = people ?? [];
  const nameOf = (id: string | null) =>
    peopleList.find((p) => p.id === id)?.full_name ?? "—";

  const all = tasks ?? [];
  const mine = all.filter(
    (t) =>
      ["open", "in_progress"].includes(t.status) &&
      (t.assignee_id === profile.id || t.assignee_role === profile.role)
  );
  const created = all.filter((t) => t.created_by === profile.id);

  const shown = (tab === "created" ? created : tab === "all" && isOwner ? all : mine)
    .slice()
    .sort(
      (a, b) =>
        (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) ||
        (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")
    );

  const tabs = [
    { key: "me", label: `For me (${mine.length})` },
    { key: "created", label: "Created by me" },
    ...(isOwner ? [{ key: "all", label: "All" }] : []),
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">Tasks</h1>
        <NewTaskDialog people={peopleList} />
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/tasks?tab=${t.key}`}
            className={`rounded-full px-3.5 py-2 text-xs font-semibold ${
              tab === t.key ? "bg-brand text-white" : "border border-line bg-white text-ink hover:bg-surface"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <SectionCard title={tab === "created" ? "Created by me" : tab === "all" ? "All tasks" : "Assigned to me / my team"}>
        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Nothing here.</p>
        ) : (
          <div className="space-y-2">
            {shown.map((t) => (
              <Link
                key={t.id}
                href={`/tasks/${t.id}`}
                className="block rounded-card bg-surface px-3 py-2 hover:bg-white"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {t.priority === "high" && (
                        <span className="rounded-full bg-danger-bg px-1.5 py-0.5 text-[9px] font-semibold text-danger">
                          HIGH
                        </span>
                      )}
                      <span className="truncate text-sm font-semibold text-ink">{t.title}</span>
                    </div>
                    <div className="truncate text-xs text-muted">
                      {t.assignee_id ? `→ ${nameOf(t.assignee_id)}` : `→ ${teamLabel(t.assignee_role)} team`}
                      {" · by "}
                      {nameOf(t.created_by)}
                      {t.contract ? ` · #${t.contract.contract_no}` : ""}
                      {t.due_date ? ` · due ${fmtDateShort(t.due_date)}` : ""}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[t.status]}`}>
                    {STATUS_LABEL[t.status]}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
