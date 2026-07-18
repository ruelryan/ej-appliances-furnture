"use client";

import { useState, useTransition } from "react";
import { addTaskComment } from "../actions";
import { btnPrimary, input } from "@/components/ui";

export function AddCommentForm({ taskId }: { taskId: string }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function action(fd: FormData) {
    const body = String(fd.get("body") ?? "").trim();
    if (!body) return;
    setError("");
    start(async () => {
      const res = await addTaskComment(taskId, body);
      if (res.error) setError(res.error);
      else (document.getElementById("comment-form") as HTMLFormElement)?.reset();
    });
  }

  return (
    <form id="comment-form" action={action} className="mt-3 flex gap-2">
      <input name="body" placeholder="Write a comment…" className={input} />
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "…" : "Send"}
      </button>
      {error && <span className="self-center text-[10px] text-danger">{error}</span>}
    </form>
  );
}
