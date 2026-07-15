// White card with the standard section header: small uppercase muted title,
// optional explainer line, optional action buttons on the right.
export function SectionCard({
  title,
  sub,
  action,
  className = "",
  children,
}: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-card border border-line bg-white p-4 ${className}`}
    >
      <div
        className={`${sub ? "mb-1" : "mb-3"} flex items-center justify-between gap-2`}
      >
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          {title}
        </h2>
        {action}
      </div>
      {sub && <p className="mb-3 text-xs text-muted">{sub}</p>}
      {children}
    </section>
  );
}
