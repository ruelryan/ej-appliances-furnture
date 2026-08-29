"use client";

import Link from "next/link";
import { useEffect } from "react";
import { btnPrimary, btnSecondary } from "@/components/ui";

/**
 * The app had no error boundary at all, so a thrown render turned into the
 * framework's raw error screen — which, for staff, is indistinguishable from
 * the app being broken forever. That is how the Tasks page failure went a
 * month without anyone being able to say what was wrong.
 *
 * The reset() retry matters more than it looks: most failures here are a
 * dropped Supabase connection on a weak mobile signal, and retrying in place
 * fixes them without losing the user's position.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Reaches the Vercel runtime logs, which is where a real diagnosis starts.
    console.error("[app] render failed:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <h1 className="text-lg font-semibold text-ink">This page didn&rsquo;t load</h1>
      <p className="mt-2 text-sm text-muted">
        Something went wrong while building the screen. Nothing you did caused
        it, and no data has been changed.
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <button type="button" onClick={reset} className={btnPrimary}>
          Try again
        </button>
        <Link href="/" className={btnSecondary}>
          Go to Home
        </Link>
      </div>
      {error.digest && (
        <p className="mt-5 text-micro text-muted">
          If it keeps happening, quote this code: <span className="font-mono">{error.digest}</span>
        </p>
      )}
    </div>
  );
}
