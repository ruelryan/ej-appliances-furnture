import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { fmtDateShort } from "@/lib/format";
import { SectionCard } from "@/components/section-card";
import { BackLink } from "@/components/back-link";
import { TaskActions } from "./task-actions";
import { AddCommentForm } from "./add-comment-form";
import { TEAM_OPTIONS } from "../new-task-dialog";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  open: "border border-line bg-white text-muted",
  in_progress: "bg-warning-bg text-warning",
  done: "bg-positive/10 text-positive",
  cancelled: "bg-danger-bg text-danger",
};
const teamLabel = (r: string) => TEAM_OPTIONS.find((t) => t.value === r)?.label ?? r;

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const { data: task } = await supabase
    .from("tasks")
    .select("*, contract:contracts(contract_no)")
    .eq("id", id)
    .maybeSingle();
  if (!task) notFound();

  const [{ data: comments }, { data: people }] = await Promise.all([
    supabase.from("task_comments").select("*").eq("task_id", id).order("created_at"),
    supabase.from("profiles").select("id, full_name, role").eq("active", true).order("full_name"),
  ]);

  const peopleList = people ?? [];
  const nameOf = (uid: string | null) => peopleList.find((p) => p.id === uid)?.full_name ?? "—";
  const canReassign = profile.role === "owner" || task.created_by === profile.id;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
        <BackLink /> {task.task_no}
      </h1>

      <SectionCard
        title={task.title}
        action={
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[task.status]}`}>
            {task.status.replace("_", " ").toUpperCase()}
          </span>
        }
      >
        {task.body && <p className="mb-3 whitespace-pre-wrap text-sm text-ink">{task.body}</p>}
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Assigned to</dt>
            <dd className="text-right text-ink">
              {task.assignee_id ? nameOf(task.assignee_id) : `${teamLabel(task.assignee_role)} team`}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Created by</dt>
            <dd className="text-right text-ink">{nameOf(task.created_by)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Priority</dt>
            <dd className="text-right text-ink capitalize">{task.priority}</dd>
          </div>
          {task.due_date && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Due</dt>
              <dd className="text-right text-ink">{fmtDateShort(task.due_date)}</dd>
            </div>
          )}
          {task.contract && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Contract</dt>
              <dd>
                <Link href={`/contracts/${task.contract_id}`} className="font-medium text-brand hover:underline">
                  #{task.contract.contract_no}
                </Link>
              </dd>
            </div>
          )}
        </dl>

        <div className="mt-4 border-t border-line pt-3">
          <TaskActions
            taskId={task.id}
            status={task.status}
            assigneeId={task.assignee_id}
            assigneeRole={task.assignee_role}
            people={peopleList}
            canReassign={canReassign}
          />
        </div>
      </SectionCard>

      <SectionCard title="Comments">
        <div className="space-y-2">
          {(comments ?? []).map((cm) => (
            <div key={cm.id} className="rounded-card bg-surface p-3 text-sm">
              <div className="mb-0.5 text-[11px] text-muted">
                {nameOf(cm.created_by)} ·{" "}
                {new Date(cm.created_at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}
              </div>
              <div className="whitespace-pre-wrap text-ink">{cm.body}</div>
            </div>
          ))}
          {(comments ?? []).length === 0 && <p className="text-sm text-muted">No comments yet.</p>}
        </div>
        <AddCommentForm taskId={task.id} />
      </SectionCard>
    </div>
  );
}
