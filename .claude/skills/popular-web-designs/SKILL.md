---
name: popular-web-designs
description: Supplies the visual vocabulary — validated palettes, font pairings, and component styles — including the E & J house style. Use when choosing or changing colors, fonts, or component looks anywhere in this app.
---

# Popular Web Designs — Visual Vocabulary

This skill supplies concrete, proven visual ingredients. Never invent tokens ad
hoc mid-task: pick from here, or extract real values from a reference the user
provides (fetch its CSS — hex codes, font names, radius — don't eyeball
screenshots).

## The E & J house style (current, authoritative)

Extracted from the user's chosen reference app. Defined in
`src/app/globals.css` under `@theme` — always reference tokens by class, never
raw hex in components.

| Token | Value | Tailwind class |
|---|---|---|
| Primary (coral) | `#f44d55` | `bg-brand` / `text-brand` |
| Primary hover | `#e13a43` | `bg-brand-dark` |
| Ink (navy) | `#2f354a` | `text-navy` |
| Accent (teal) | `#669999` / hover `#578a8a` | `bg-teal` / `bg-teal-dark` |
| Surface (light gray) | `#f0f1f2` | `bg-surface` / `border-surface` |
| Muted text | `#7b8194` | `text-muted` |
| Danger | `#a32530` on `#fdecec` | `text-danger` / `bg-danger-bg` |
| Radius | 14px everywhere | `rounded-card` (pills: `rounded-full`) |

**Typography:** Poppins 500/600 for headings and titles (`font-display` +
`font-semibold`, never `font-bold` — 700 isn't loaded and fake-bolds), Lato
400/700 for body. Loaded via `next/font` in `src/app/layout.tsx`.

**Component idioms:** white cards with 1px `border-surface` + `rounded-card`;
chunky full-width primary buttons (coral, white bold text, soft coral shadow on
hero CTAs); thin coral progress bars with a percent label below
(`src/components/paid-progress.tsx`); solid pills for status; hairline-divided
list rows with a bold Poppins title and a `·`-separated muted meta line;
sub-page titles get a `←` BackLink.

**Reserved meanings:** coral = actions; the darker `danger` red = destructive/
overdue only; teal = secondary actions and "on track". Never use coral for
warnings or danger for buttons.

**Charts are exempt** from the house palette: they use the validated
accessibility palette in `globals.css` (`--chart-*`, `--status-*`) — see the
dataviz skill before touching any chart colors.

## Alternate vocabularies (only if the user asks for a new look)

- **Fintech light**: ink `#111827`, primary `#2563eb`, surface `#f3f4f6`,
  radius 12px, Inter only (600 headings / 400 body).
- **Warm paper**: ink `#292524`, primary `#0d9488`, surface `#f5f5f4`,
  radius 8px, Fraunces headings + Source Sans body.
- **Dark ops**: bg `#0f172a`, card `#1e293b`, primary `#38bdf8`,
  text `#e2e8f0`, radius 10px, system-ui.

## Rules

1. One primary accent per app. Secondary colors get secondary jobs.
2. Radius is uniform across the app — mixed radii read as sloppy.
3. Muted text for meta, ink for content; never gray-on-gray below 4.5:1 for
   body text.
4. When restyling many files, write a sweep script with an explicit
   old-class → new-class mapping table; never hand-edit 30 files.
