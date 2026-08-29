import Link from "next/link";

/**
 * A single headline figure.
 *
 * Two additions over the original label+value version, both driven by the
 * dashboard rewrite:
 *
 * `sub` — a number with no baseline supports no decision. "₱180,000 collected"
 * is trivia; "₱180,000 — 78% of what was due" is something you can act on. The
 * comparison is the point of the tile, not decoration.
 *
 * `href` — a tile used to be a dead end. Every figure on the dashboard now
 * leads to the list that explains it, so noticing a problem and starting to
 * work on it are the same gesture.
 */
export function StatTile({
  label,
  value,
  sub,
  alert = false,
  tone,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Legacy flag, kept so existing call sites need no edit. Same as tone="alert". */
  alert?: boolean;
  tone?: "default" | "alert" | "positive";
  href?: string;
}) {
  const resolved = tone ?? (alert ? "alert" : "default");
  const valueColor =
    resolved === "alert"
      ? "text-danger"
      : resolved === "positive"
        ? "text-positive"
        : "text-ink";

  const body = (
    <>
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${valueColor}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-micro text-muted">{sub}</div>}
    </>
  );

  const base = "rounded-card border border-line bg-white p-4";
  if (!href) return <div className={base}>{body}</div>;

  return (
    <Link href={href} className={`${base} block transition hover:border-brand/40 hover:bg-surface`}>
      {body}
    </Link>
  );
}
