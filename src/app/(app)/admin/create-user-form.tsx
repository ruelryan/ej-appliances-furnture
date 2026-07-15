"use client";

import { useActionState } from "react";
import { createUser } from "./actions";

export function CreateUserForm() {
  const [state, formAction, pending] = useActionState(createUser, null);

  const input =
    "w-full rounded-card border border-surface px-3 py-2 text-sm";

  return (
    <form action={formAction} className="space-y-3 border-t border-surface pt-4">
      <h3 className="text-sm font-semibold text-navy">
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
        <select name="role" defaultValue="staff" className={input}>
          <option value="staff">Staff</option>
          <option value="owner">Owner</option>
        </select>
      </div>

      {state && "error" in state && state.error && (
        <p className="rounded-card bg-danger-bg px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state && "success" in state && state.success && (
        <p className="rounded-card bg-surface px-3 py-2 text-sm text-teal-dark">
          {state.success}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-card bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create account"}
      </button>
    </form>
  );
}
