# Fluid scaling — the one law for responsive sizes

> Applies to all UI code (components, pages, views). For a full conversion of an existing
> page/component, use the **`fluidize`** skill. This rule is the always-on quick reference so
> new UI is authored fluid from the start.

**Any size, spacing, width/height, or font that scales between viewports is a two-anchor `fl-*`
utility — never a breakpoint-stepped size.** Author it as the two design numbers: `a` @360px,
`b` @1440px → `fl-<prop>-[a,b]` (e.g. `fl-text-[14,16]`, `fl-p-[16,24]`, `fl-gap-[8,12]`,
`fl-h-[44,60]`, `fl-w-[280,480]`). It glides continuously 360→1440, then damps to a ×1.167 ceiling
at 1920 and freezes. No breakpoint jump.

**Fluidize vs. keep a `lg:` breakpoint:**

| Make it fluid (`fl-*`) | Keep the `lg:` breakpoint |
|---|---|
| font-size, gaps, paddings, margins, widths, heights, icon/card sizes that simply grow | **layout-mode switches**: grid↔flex, stacked↔columns, `hidden lg:flex`, aspect-ratio swaps |
| a `w-[176px] lg:w-[180px]` / `gap-4 lg:gap-6` that's just a size delta | where mobile vs desktop is a different *structure*, not a different *size* |

A pure size delta stepped at `lg:` is a bug the plugin can't catch — glide it with `fl-*`. Only step
when the delta rides a real structure change (then use `lg:fl-d-*`, never raw px).

**Single-layout components** use ONE anchor: `fl-m-<prop>-[n]` (mobile-only) / `fl-d-<prop>-[n]`
(desktop-only). **Fixed-width surfaces** (drawers/modals) use frozen values, not viewport units.

**Hard rules (the `check-fluid` commit gate enforces these):**
- Inputs/textareas/selects: mobile font ≥ 16px (iOS focus auto-zoom).
- Font tokens: wide-max ≤ 2.5·a (WCAG 1.4.4). Any token: `b ≤ 4·a`.
- Never `width: 100vw` (use `width: 100%` on an uncapped wrapper). No raw `clamp()`/`calc()` scaling in
  components — always an `fl-*` utility.

**Letter-spacing** is `em`; **line-height** is a unitless ratio (don't fluidize unless the ratio itself
changes between anchors). Font-size is always the single `fl-text` value — but its letter-spacing /
line-height MAY differ per breakpoint via an `lg:` override.

**Multi-value class strings go through `cn()`** so an `fl-*` class dedupes against any native class it
overrides. Never concatenate class strings where an `fl-*` and a native class can collide.

The math is locked in `scripts/fluid-math.mjs` (imported by the plugin, the validator, and the tests —
one source of truth). Never inline a raw `clamp()`; never fork the math.
