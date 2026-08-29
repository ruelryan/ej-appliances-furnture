// The "nothing here" state, which appeared ~20 times as a bare centred
// paragraph with the vertical padding picked by eye (py-4, py-6 and py-8 all
// occur). An empty list is a moment where the user is most likely to think the
// app is broken, so it gets a line saying what would appear here and, where
// there is one, the action that fills it.

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-sm text-xs text-muted">{hint}</p>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}
