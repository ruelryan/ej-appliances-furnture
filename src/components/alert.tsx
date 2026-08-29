// One banner, four honest tones.
//
// The danger variant was written out as a literal in ~40 places, half of them
// `text-sm` and half `text-xs` with no rule deciding which. Success and
// informational states had no tokens at all, so they were improvised as
// bg-brand/10 or a bare text-positive.
//
// No icons and no emoji: the house style carries meaning in the tint, and the
// text always says what happened.

const TONES = {
  danger: "bg-danger-bg text-danger",
  warning: "border border-warning/40 bg-warning-bg text-warning",
  positive: "bg-positive/10 text-positive",
  info: "bg-brand/10 text-brand",
} as const;

export type AlertTone = keyof typeof TONES;

export function Alert({
  tone = "danger",
  title,
  children,
  className = "",
}: {
  tone?: AlertTone;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={`rounded-card px-3 py-2 text-sm ${TONES[tone]} ${className}`}
    >
      {title && <div className="font-semibold">{title}</div>}
      {children}
    </div>
  );
}
