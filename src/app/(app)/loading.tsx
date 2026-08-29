// The app had no loading state anywhere. On rural mobile data a page that
// awaits several Supabase queries left the user staring at the previous screen
// with no sign anything was happening, so taps got repeated.
//
// Note this shows on client-side navigation between pages, not on the very
// first load of a force-dynamic route — that is how streaming works, and is
// expected rather than a bug.
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <div className="h-6 w-40 animate-pulse rounded-card bg-surface" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[86px] animate-pulse rounded-card border border-line bg-white" />
        ))}
      </div>
      <div className="h-52 animate-pulse rounded-card border border-line bg-white" />
      <div className="h-40 animate-pulse rounded-card border border-line bg-white" />
    </div>
  );
}
