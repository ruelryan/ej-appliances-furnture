"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PrintControls({ filename = "document" }: { filename?: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function downloadJpg() {
    const node = document.getElementById("print-area");
    if (!node) return;
    setSaving(true);
    // Pin the page to A4 width during capture so the JPG comes out the same
    // size on every device — otherwise a narrow phone viewport shrinks the
    // layout and clips wide tables.
    const A4_PX = 794; // 210mm at 96dpi
    const prev = {
      width: node.style.width,
      maxWidth: node.style.maxWidth,
      margin: node.style.margin,
    };
    try {
      await document.fonts.ready;
      node.style.width = `${A4_PX}px`;
      node.style.maxWidth = "none";
      node.style.margin = "0";
      const { toJpeg } = await import("html-to-image");
      const url = await toJpeg(node, {
        quality: 0.92,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        filter: (n) =>
          !(n instanceof HTMLElement && n.hasAttribute("data-no-export")),
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filename}.jpg`;
      a.click();
    } finally {
      node.style.width = prev.width;
      node.style.maxWidth = prev.maxWidth;
      node.style.margin = prev.margin;
      setSaving(false);
    }
  }

  return (
    <div data-no-export className="mb-4 flex flex-wrap gap-2 print:hidden">
      <button
        onClick={() => router.back()}
        className="rounded-card border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-surface"
      >
        ← Back
      </button>
      <button
        onClick={() => window.print()}
        className="rounded-card bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
      >
        Print / Save as PDF
      </button>
      <button
        onClick={downloadJpg}
        disabled={saving}
        className="rounded-card border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-50"
      >
        {saving ? "Preparing…" : "Download JPG"}
      </button>
    </div>
  );
}
