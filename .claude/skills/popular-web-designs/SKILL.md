---
name: popular-web-designs
description: Supplies the visual vocabulary — validated palettes, font pairings, and component styles — including the E & J house style. Use when choosing or changing colors, fonts, or component looks anywhere in this app.
---

# Popular Web Designs — Visual Vocabulary

This skill supplies concrete, proven visual ingredients. Never invent tokens ad
hoc mid-task: pick from here, or extract real values from a reference the user
provides (fetch its CSS — hex codes, font names, radius — don't eyeball
screenshots).

## The E & J house style (current, authoritative): "fintech light"

Chosen by the owner from sketched variants (2026-07). Defined in
`src/app/globals.css` under `@theme` — always reference tokens by class, never
raw hex in components.

| Token | Value | Tailwind class |
|---|---|---|
| Primary (blue) | `#2563eb` | `bg-brand` / `text-brand` |
| Primary hover | `#1d4ed8` | `bg-brand-dark` |
| Ink (near-black) | `#111827` | `text-ink` |
| Positive (green) | `#047857` / dark `#065f46` | `bg-positive` / `text-positive` |
| Surface (cool gray) | `#f3f4f6` | `bg-surface` (page bg + gray fills) |
| Hairline | `#e5e7eb` | `border-line` / `divide-line` |
| Muted text | `#6b7280` | `text-muted` |
| Warning (amber) | `#b45309` on `#fffbeb` | `text-warning` / `bg-warning-bg` |
| Danger | `#b91c1c` on `#fef2f2` | `text-danger` / `bg-danger-bg` |
| Radius | 12px everywhere | `rounded-card` (pills: `rounded-full`) |
| CTA shadow | soft blue | `shadow-cta` |

**Typography:** Inter (variable, all weights load) for everything, via
`next/font` in `src/app/layout.tsx` (`--font-body`; `--font-heading` aliases
it). Headings and emphasis use `font-semibold` (600) — keep `font-bold` out of
the UI for a calmer look. Money is always `tabular-nums`.

**Component idioms:** white cards with 1px `border-line` + `rounded-card` on
the gray `bg-surface` page; section headers via `SectionCard`
(`src/components/section-card.tsx`) — 11px uppercase muted titles; buttons and
inputs come from the class constants in `src/components/ui.ts` (`btnPrimary`,
`btnPrimaryHero`, `btnSecondary`, `btnDanger`, `input`, `label`, `theadRow`);
stat tiles via `StatTile`; lists are rows inside ONE card container
(`divide-y divide-line overflow-hidden rounded-card border border-line
bg-white`, rows `hover:bg-surface`); status pills are soft tints
(`TierBadge`); thin blue progress bar (`PaidProgress`); nav icons are the
inline SVGs in `nav-links.tsx` — **no emoji in the UI** (emoji live only
inside customer-facing message templates in `src/lib/messages.ts`);
sub-page titles get a `←` BackLink.

**Reserved meanings:** blue = actions, links, and active nav; green
`positive` = "on track" and success notes; amber `warning` = overdue caution
pills; `danger` red = destructive actions and overdue amounts only. Never use
blue for warnings or danger for ordinary buttons.

**Charts are exempt** from the house palette: they use the validated
accessibility palette in `globals.css` (`--chart-*`, `--status-*`) — see the
dataviz skill before touching any chart colors.

## Alternate vocabularies (only if the user asks for a new look)

- **Warm paper**: ink `#292524`, primary `#0d9488`, surface `#f5f5f4`,
  radius 8px, Fraunces headings + Source Sans body.
- **Dark ops**: bg `#0f172a`, card `#1e293b`, primary `#38bdf8`,
  text `#e2e8f0`, radius 10px, system-ui.
- **Coral scanner** (retired 2026-07 house style): coral `#f44d55`, navy ink
  `#2f354a`, teal `#669999`, surface `#f0f1f2`, radius 14px, Poppins 500/600
  headings + Lato 400/700 body.

## Rules

1. One primary accent per app. Secondary colors get secondary jobs.
2. Radius is uniform across the app — mixed radii read as sloppy.
3. Muted text for meta, ink for content; never gray-on-gray below 4.5:1 for
   body text.
4. When restyling many files, write a sweep script with an explicit
   old-class → new-class mapping table; never hand-edit 30 files.
