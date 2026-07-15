"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, null);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface p-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-white p-8 shadow-sm">
        <div className="mb-8 text-center">
          <div className="font-display text-2xl font-semibold text-ink">
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
              className="mb-1 block text-sm font-medium text-ink"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="w-full rounded-card border border-line px-3 py-2.5 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-ink"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-card border border-line px-3 py-2.5 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
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
            className="w-full rounded-card bg-brand py-3 text-base font-semibold text-white shadow-cta transition hover:bg-brand-dark disabled:opacity-60 disabled:shadow-none"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
