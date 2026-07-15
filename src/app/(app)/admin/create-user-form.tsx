"use client";

import { useActionState } from "react";
import { createUser } from "./actions";

export function CreateUserForm() {
  const [state, formAction, pending] = useActionState(createUser, null);

  const input =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";

  return (
    <form action={formAction} className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
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
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </p>
      )}
      {state && "success" in state && state.success && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          {state.success}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-sky-800 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create account"}
      </button>
    </form>
  );
}
