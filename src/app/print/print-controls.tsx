"use client";

import { useRouter } from "next/navigation";

export function PrintControls() {
  const router = useRouter();
  return (
    <div className="mb-4 flex gap-2 print:hidden">
      <button
        onClick={() => router.back()}
        className="rounded-card border border-surface px-4 py-2 text-sm font-semibold text-navy hover:bg-surface"
      >
        ← Back
      </button>
      <button
        onClick={() => window.print()}
        className="rounded-card bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
      >
        🖨️ Print / Save as PDF
      </button>
    </div>
  );
}
