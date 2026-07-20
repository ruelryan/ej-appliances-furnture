export function StatTile({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className="rounded-card border border-line bg-white p-4">
      <div className="text-xs text-muted">{label}</div>
      <div
        className={`mt-1 text-lg font-semibold tabular-nums ${
          alert ? "text-danger" : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
