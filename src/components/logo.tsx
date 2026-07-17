// E & J house mark: home outline with a plug bolt. Inherits currentColor —
// wrap in text-brand for app surfaces, text-ink/text-black for print.
export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 30 L32 12 L54 30" />
        <path d="M16 27 V52 a3 3 0 0 0 3 3 H45 a3 3 0 0 0 3-3 V27" />
      </g>
      <path
        d="M34.5 28 L26.5 40.5 H31.5 L29.5 49 L37.5 36.5 H32.5 Z"
        fill="currentColor"
      />
    </svg>
  );
}
