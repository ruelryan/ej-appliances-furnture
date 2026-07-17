"use client";

import { useActionState } from "react";
import { createUser } from "./actions";
import { btnPrimary, input } from "@/components/ui";

export function CreateUserForm() {
  const [state, formAction, pending] = useActionState(createUser, null);

  return (
    <form action={formAction} className="space-y-3 border-t border-line pt-4">
      <h3 className="text-sm font-semibold text-ink">
        Add user
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <input name="full_name" placeholder="Full name" required className={input} />
        <input name="email" type="email" placeholder="Email" required className={input} />
        <input
          name="password"
          type="password"
          placeholder="Password (min 8 chars)"
          minLength={8}
          required
          className={input}
        />
        <select name="role" defaultValue="collector" className={input}>
          <option value="collector">Collector</option>
          <option value="admin">Admin assistant</option>
          <option value="sales_agent">Sales agent</option>
          <option value="delivery">Delivery</option>
          <option value="owner">Owner</option>
        </select>
      </div>

      {state && "error" in state && state.error && (
        <p className="rounded-card bg-danger-bg px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state && "success" in state && state.success && (
        <p className="rounded-card bg-positive/10 px-3 py-2 text-sm text-positive">
          {state.success}
        </p>
      )}

      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Creating…" : "Create account"}
      </button>
    </form>
  );
}
