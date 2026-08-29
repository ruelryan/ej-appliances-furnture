// Shared class strings for the "fintech light" system.
//
// Constants rather than components: forms style plain `<button>`/`<Link>`
// elements directly, and a server component can import a string with none of
// the client-boundary cost a wrapper component would carry.
//
// The set used to stop at eight, which is why the app grew a fifth and sixth
// button style by hand. Anything a page needs more than twice belongs here.

// Every button shares this: a 40px minimum height (the house touch-target
// floor — the hand-rolled "small" variant that appeared in ~39 places was
// about 30px, which is a miss on a phone), centred content, and room for an
// icon beside the label.
const btnBase =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-card font-semibold disabled:opacity-50";

const btnMd = "px-3 py-2 text-sm";
// Visually smaller — 12px type, tighter sides — but the same 40px target.
// Small must mean "reads quieter", never "harder to hit".
const btnSm = "px-3 text-xs";

export const btnPrimary = `${btnBase} ${btnMd} bg-brand text-white hover:bg-brand-dark`;
export const btnPrimarySm = `${btnBase} ${btnSm} bg-brand text-white hover:bg-brand-dark`;

export const btnSecondary = `${btnBase} ${btnMd} border border-line bg-white text-ink hover:bg-surface`;
export const btnSecondarySm = `${btnBase} ${btnSm} border border-line bg-white text-ink hover:bg-surface`;

export const btnPositive = `${btnBase} ${btnMd} bg-positive text-white hover:bg-positive-dark`;
export const btnPositiveSm = `${btnBase} ${btnSm} bg-positive text-white hover:bg-positive-dark`;

export const btnDanger = `${btnBase} ${btnMd} bg-danger text-white hover:bg-danger/90`;
export const btnDangerSm = `${btnBase} ${btnSm} bg-danger text-white hover:bg-danger/90`;

// The tinted low-emphasis button. copy-button.tsx invented this independently;
// promoting it stops the next person inventing a seventh.
export const btnGhost = `${btnBase} ${btnMd} bg-brand/10 text-brand hover:bg-brand/15`;
export const btnGhostSm = `${btnBase} ${btnSm} bg-brand/10 text-brand hover:bg-brand/15`;

// Square, icon-only. For chip rows where five labelled buttons would wrap.
export const btnIcon =
  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-card border border-line bg-white text-ink hover:bg-surface";

export const btnPrimaryHero =
  "w-full rounded-card bg-brand py-3 text-base font-semibold text-white shadow-cta transition hover:bg-brand-dark disabled:opacity-50 disabled:shadow-none";

// ── Form controls ───────────────────────────────────────────────────────────
// 16px type on every one of these is load-bearing: below that, iOS zooms the
// viewport on focus and the user loses their place in the form.
export const input =
  "w-full rounded-card border border-line bg-white px-3 py-2.5 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/25";

// There are 31 raw <select> elements in the app, every one styled by hand and
// most with no focus treatment at all. Same box as `input` so a select and a
// text field sitting side by side finally line up.
export const select = `${input} appearance-none pr-8`;

export const textarea = `${input} min-h-20 resize-y`;

export const label = "mb-1 block text-sm font-medium text-ink";
export const hint = "mt-1 text-xs text-muted";
export const fieldError = "mt-1 text-xs font-medium text-danger";

// ── Tables ──────────────────────────────────────────────────────────────────
export const theadRow = "border-b border-line text-left text-xs text-muted";
export const td = "py-1.5 pr-3";
// Money and counts: right-aligned with tabular figures so digits line up
// column-wise. Every peso figure in the app should use this.
export const tdNum = "py-1.5 pr-3 text-right tabular-nums";

// ── Layout rhythm ───────────────────────────────────────────────────────────
// Page roots previously picked space-y-4, -5 or -6 by accident; lists got 4,
// detail pages 5 and dashboards 6 with no rule behind it. One value each.
export const pageStack = "space-y-5";
export const cardStack = "space-y-3";

// The list-of-rows container: one card, hairline dividers, rows highlight on
// hover. Already the de-facto idiom on contracts/payments/customers.
export const listCard =
  "divide-y divide-line overflow-hidden rounded-card border border-line bg-white";
