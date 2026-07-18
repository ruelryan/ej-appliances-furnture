"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function revalidate(taskId?: string) {
  revalidatePath("/tasks");
  if (taskId) revalidatePath(`/tasks/${taskId}`);
}

export async function createTask(input: {
  title: string;
  body: string;
  assigneeId: string | null;
  assigneeRole: string | null;
  priority: string;
  dueDate: string;
  contractId: string | null;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_task", {
    p_title: input.title,
    p_body: input.body || null,
    p_assignee_id: input.assigneeId,
    p_assignee_role: input.assigneeRole,
    p_priority: input.priority,
    p_due_date: input.dueDate || null,
    p_contract_id: input.contractId,
    p_customer_id: null,
  });
  if (error) return { error: error.message };
  revalidate();
  return { taskId: data.id as string };
}

export async function setTaskStatus(taskId: string, status: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_task_status", {
    p_task_id: taskId,
    p_status: status,
  });
  if (error) return { error: error.message };
  revalidate(taskId);
  return {};
}

export async function reassignTask(
  taskId: string,
  assigneeId: string | null,
  assigneeRole: string | null
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reassign_task", {
    p_task_id: taskId,
    p_assignee_id: assigneeId,
    p_assignee_role: assigneeRole,
  });
  if (error) return { error: error.message };
  revalidate(taskId);
  return {};
}

export async function addTaskComment(taskId: string, body: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_task_comment", {
    p_task_id: taskId,
    p_body: body,
  });
  if (error) return { error: error.message };
  revalidate(taskId);
  return {};
}
