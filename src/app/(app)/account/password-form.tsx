"use client";

import { useActionState } from "react";
import { changePassword } from "./actions";
import { btnPrimaryHero, input, label } from "@/components/ui";

export function PasswordForm() {
  const [state, formAction, pending] = useActionState(changePassword, null);

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label htmlFor="current_password" className={label}>
          Current password
        </label>
        <input
          id="current_password"
          name="current_password"
          type="password"
          autoComplete="current-password"
          required
          className={input}
        />
      </div>
      <div>
        <label htmlFor="new_password" className={label}>
          New password <span className="text-muted">(min 8 characters)</span>
        </label>
        <input
          id="new_password"
          name="new_password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          className={input}
        />
      </div>
      <div>
        <label htmlFor="confirm_password" className={label}>
          Repeat new password
        </label>
        <input
          id="confirm_password"
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          className={input}
        />
      </div>

      {state?.error && (
        <p className="rounded-card bg-danger-bg px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state?.success && (
        <p className="rounded-card bg-positive/10 px-3 py-2 text-sm text-positive">
          {state.success}
        </p>
      )}

      <button type="submit" disabled={pending} className={btnPrimaryHero}>
        {pending ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
