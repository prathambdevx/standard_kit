# ios-safari-fixes

Seven recurring iOS Safari rendering bugs — each one learned from a real bug that shipped, only
surfaced on a physical iPhone (never reproduced in Chrome DevTools' device emulation), and had to
be fixed after the fact. Bake these in while writing the code instead of waiting for iPhone QA.

## What's in here

- **`SKILL.md`** — the 7 rules with real before/after code from the actual fix commits: SVG
  viewBox clipping, `w-auto` ignoring hardcoded SVG width/height attributes, sub-16px input
  auto-zoom, `dvh` resizing with the URL bar (use `svh`), `overflow:hidden` not locking scroll on
  iOS (needs `position:fixed`), `safe-area-inset-bottom` double-stacking, and SVGs flickering next
  to a height/layout animation (promote with `transform-gpu backface-hidden`).
- **`ISSUES.md`** — a plain running log of iOS-only bugs as they surface; add a bullet each time.
- **`css/ios-safari.css`** — the one global CSS fix (rule 1): `svg { overflow: visible }` in
  `@layer base`.
- **`scripts/check-ios-safari.mjs`** + **`.test.mjs`** — a new static validator (14 tests) that
  mechanically catches 4 of the 7 rules (SVG auto-size, input zoom, dvh usage as an info-level
  nudge, safe-area double-stacking). Rules 1, 5, and 7 are a one-time CSS change, a shared hook, and
  a by-eye adjacency call respectively — nothing left to lint once they're in place.

## Install in a new project

1. Merge `css/ios-safari.css` into your `globals.css`.
2. Copy `scripts/check-ios-safari.mjs` (+ its test) into your project's `scripts/`.
3. Wire it into your commit gate (same pattern as `fluid-setup`'s `check-fluid.mjs` — see that
   kit's `assets/wiring/lefthook-snippet.yml` for the shape):
   ```yaml
   ios-safari:
     glob: "src/**/*.{tsx,jsx}"
     run: bun scripts/check-ios-safari.mjs {staged_files}
   ```
4. Rule 5 (scroll lock) — use `useBodyScrollLock` from the `ui-components` kit instead of
   hand-rolling `overflow: hidden` anywhere you build a modal/drawer/overlay.
5. Point Claude at `SKILL.md` (as a rule or a skill) so it applies these proactively while
   writing new components, not just when the validator catches something after the fact.

## Adapt before use

- The validator's `input-zoom` rule flags `text-xs`/`text-sm`/`text-[<16]px]` — if your project's
  Tailwind config remaps those scale names to different pixel values, adjust `SMALL_TEXT_CLASS_RE`
  accordingly.
- The `dvh-usage` finding is deliberately `info` severity (doesn't fail the gate) — `dvh` has
  legitimate uses; it's a nudge to confirm, not a hard rule. Promote it to `error` in your own
  fork of the script if your project wants it enforced strictly.
