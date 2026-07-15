"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, null);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-white p-4">
      <div className="w-full max-w-sm rounded-card border border-surface bg-white p-8 shadow-sm">
        <div className="mb-8 text-center">
          <div className="font-display text-2xl font-semibold text-navy">
            E &amp; J
          </div>
          <div className="text-sm text-muted">
            Appliances &amp; Furniture
          </div>
        </div>

        <form action={formAction} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-sm font-medium text-navy"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="w-full rounded-card border border-surface px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-navy"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-card border border-surface px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
            />
          </div>

          {state?.error && (
            <p className="rounded-card bg-danger-bg px-3 py-2 text-sm text-danger">
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-card bg-brand py-3 text-base font-bold text-white shadow-[0_2px_8px_rgba(244,77,85,0.3)] transition hover:bg-brand-dark disabled:opacity-60 disabled:shadow-none"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
