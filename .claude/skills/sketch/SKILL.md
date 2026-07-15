---
name: sketch
description: Quick disposable HTML mockups for exploring design directions before committing to React code. Use when the user is choosing between layouts/looks, or before building any significant new screen.
---

# Sketch — Disposable Mockups

Explore cheaply in throwaway HTML; build expensively only once, in React.

## How

1. Write a **single self-contained HTML file** per direction into the session
   scratchpad directory (never into `src/`): inline `<style>`, no build step,
   no React, no Tailwind — plain CSS using the E & J tokens copied in as CSS
   variables (see `popular-web-designs` for values). Hardcode realistic data
   from the actual business (real-looking names, peso amounts, contract nos).
2. Frame it phone-width: `body { max-width: 390px; margin: 0 auto; }`.
3. Open it for the user: `Start-Process <path>` (default browser), or render
   variants side-by-side in one file with a flex row of phone frames when
   comparing 2–3 directions.
4. Ask the user to pick (AskUserQuestion with the variant names). THEN build
   the winner properly in React with real data.

## Rules

- Sketches are **disposable**: never import them, never commit them, never
  let sketch CSS leak into `src/`. The scratchpad is their home and grave.
- A sketch answers exactly one question ("card list or table?", "bar above or
  below?"). If you can't name the question, you don't need a sketch.
- 10-minute budget per sketch. No JavaScript unless the question is about an
  interaction.
- Skip sketching for small tweaks (color/spacing/label changes) — just make
  the change; the dev server is the preview.
