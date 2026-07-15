"use client";

import { useRouter } from "next/navigation";

export function PrintControls() {
  const router = useRouter();
  return (
    <div className="mb-4 flex gap-2 print:hidden">
      <button
        onClick={() => router.back()}
        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
      >
        ← Back
      </button>
      <button
        onClick={() => window.print()}
        className="rounded-lg bg-sky-800 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
      >
        🖨️ Print / Save as PDF
      </button>
    </div>
  );
}
