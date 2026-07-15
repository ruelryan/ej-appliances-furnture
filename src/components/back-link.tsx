"use client";

import { useRouter } from "next/navigation";

// The reference app's ← beside sub-page titles.
export function BackLink() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label="Go back"
      className="-ml-1 rounded-full p-1 text-xl leading-none text-ink hover:bg-surface"
    >
      ←
    </button>
  );
}
