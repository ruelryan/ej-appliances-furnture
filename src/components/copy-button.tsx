"use client";

import { useState } from "react";

export function CopyButton({ text, label = "📋 Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-card bg-teal px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-dark"
    >
      {copied ? "✅ Copied!" : label}
    </button>
  );
}
