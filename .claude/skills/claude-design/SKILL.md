---
name: claude-design
description: Drives the design process — surface-first thinking, an anti-slop audit, and tweakable variants. Use when designing or redesigning any screen, page, or component in this app, before writing UI code.
---

# Claude Design — Process

How to design, not what it looks like (the vocabulary lives in
`popular-web-designs`). Follow the three moves in order.

## 1. Surface-first thinking

Design the highest-stakes surface first and let it set the rules for
everything else. In this app the hierarchy is:

1. **Customer card** (`/contracts/[id]`) — the hub; collectors live here
2. **Collections worklist** and **payment quick-entry** — field use, one-thumb
3. Lists (contracts / customers / payments)
4. Dashboard & analytics
5. Admin, print pages

Never design a low-tier surface in a way that contradicts a higher one. Before
coding, state (one short paragraph): who uses this screen, on what device,
what's the one thing they came to do, and what the screen's single most
prominent element therefore must be.

Mobile is the primary device for staff surfaces (tiers 1–3): design at 390px
wide first, desktop is the adaptation.

## 2. Anti-slop audit

Run this checklist over every screen you build or change. Each item is a
known "AI-generated look" tell:

- [ ] No fake bold: only loaded font weights (Poppins 500/600, Lato 400/700)
- [ ] One accent color doing one job; danger red never used decoratively
- [ ] Uniform radius (`rounded-card`); no mixed 8/12/16 corners
- [ ] Real data in examples, never lorem ipsum or "John Doe"
- [ ] Spacing from a scale (Tailwind 2/3/4/5/6), not eyeballed one-offs
- [ ] Meta text is genuinely muted; headings genuinely heavier — visible
      hierarchy with the page zoomed out to 50%
- [ ] No gradients unless the reference design has them (E & J's doesn't)
- [ ] No emoji as icons on NEW surfaces without checking existing pages'
      conventions first (this app deliberately uses a few — stay consistent)
- [ ] Empty, loading, and error states designed — not just the happy path
- [ ] Tap targets ≥ 40px on staff surfaces; inputs ≥ 16px font (blocks iOS zoom)
- [ ] Interactive elements have hover/disabled states

After building: `npm run build` must pass, then actually look at the screen
(dev server) at phone width before calling it done.

## 3. Tweakable variants

When the user asks for something new (not a tweak), don't present one take.
Offer 2–3 variants that differ on ONE meaningful axis (density, emphasis, or
layout — never three random looks), as cheap sketches first (see the `sketch`
skill) or as an AskUserQuestion with concrete descriptions. Build only the
chosen one properly. When the user gives a reference image or app, extraction
beats invention: get the real tokens (CSS, fonts, spacing) and reproduce them.
