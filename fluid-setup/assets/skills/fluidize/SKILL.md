---
name: fluidize
description: Convert a page, view, or component to the fluid (fl-*) scaling system — every size, spacing, width/height, and font that should grow between viewports becomes a two-anchor fl-* utility that glides smoothly (no breakpoint jumps). Use when the user says "fluidize X", "make X fluid", "convert X to fl-*", "scale X responsively", or when building new UI that must scale across viewports. Requires the fluid engine to be installed (run the fluid-setup skill once per project first).
---

# Fluidize — make a page or component scale fluidly

The fluid system replaces breakpoint-stepped sizes (`text-sm lg:text-base`, `w-[176px] lg:w-[180px]`,
`gap-4 lg:gap-6`) with **two-anchor `fl-*` utilities** that glide continuously between a mobile design
width (360px) and a desktop design width (1440px), then freeze. One value, authored as the two Figma
numbers, replaces the jump.

> **Prerequisite:** the engine must be installed (plugin + `scripts/fluid-math.mjs` + `check-fluid`
> validator + `cn.ts` wiring + the `@plugin` line in globals.css). If `fl-text-[14,16]` isn't a known
> class, run the **fluid-setup** skill once first. The deep math + rationale lives in
> `references/model.md` — read it before changing any constant or reasoning about the curve.

## The law (memorize this)

Author every scalable value as two numbers: `a` = value @360px, `b` = value @1440px.
Write `fl-<prop>-[a,b]` — e.g. `fl-text-[14,16]`, `fl-p-[16,24]`, `fl-h-[44,60]`, `fl-gap-[8,12]`.

| Zone | Viewport range | Behavior |
|---|---|---|
| **M** | 360 → 480 | proportional zoom `a·vw/360`, capped at `min(4⁄3·a, b)` — never overshoots `b`; `a=b` never moves |
| **G** | cap → 1440 | linear glide to `b`; continuous with M (no jump); pixel-exact `b` at 1440 |
| **W** | 1440 → 1920 | damped `×(1 + 0.5·(vw−1440)/1440)` → max ×1.167 @1920, frozen beyond |

- `a > b` (value shrinks as viewport grows) → single ramp 360→1440, frozen outside.
- `fl-*-[X,X,flat]` → constant, never scales (hairlines, 1px borders, alignment constants ONLY).
- Single layout only? Use **one** anchor, not a fabricated pair: `fl-m-<prop>-[n]` (mobile-only) or
  `fl-d-<prop>-[n]` (desktop-only). See model.md.

**Families** (all registered in the plugin's `PROPS` + `cn.ts`'s `FL_NATIVE`):
`text` `leading` `gap` `gap-x` `gap-y` `w` `h` `min-h` `max-w` `basis` `p` `px` `py` `pt` `pb` `pl` `pr`
`m` `mx` `my` `mt` `mb` `ml` `mr` `top` `bottom` `left` `right` `size`. Plus `fl-art-text-[design,columnDesign]`.

## Hard rules (the validator/commit gate enforces these — they fail the build)

1. **Inputs ≥16px on mobile.** Any `fl-text-[a,…]` with `a < 16` on a text-entry control
   (`<input>`/`<textarea>`/`<select>`) is a build error — iOS Safari auto-zooms the viewport on focus of
   a sub-16px field. (Add such files to `INPUT_ATOM_FILES` in `scripts/check-fluid.mjs`; a per-line
   `fl-input-floor-exempt: <reason>` comment waives it for a non-input element in the same file.)
2. **Font wide cap ≤ 2.5·a** (WCAG 1.4.4). The validator throws on a font token whose wide-max exceeds it.
3. **`b ≤ 4·a`.** A value that must grow more than 4× is not one fluid value — art-direct or flat it.
4. **Never `width: 100vw`** (Windows scrollbar overflow). Full-bleed = `width: 100%` on an uncapped wrapper.
5. **No raw `clamp()`/`calc()` scaling in components** — always an `fl-*` utility (or a documented CSS var
   pinning `emit()` output when JS must read the value, e.g. composed with `env(safe-area-inset-*)`).

## Rules that need judgment (read before converting)

- **Layout-mode switches STAY breakpoints.** `hidden lg:flex`, grid↔flex, stacked↔columns, aspect swaps —
  the fluid system replaces *sizes*, never *structure*. Keep the `lg:` there.
- **The converse — a pure size/spacing delta must NOT be raw-`lg:`-stepped.** `w-[176px] lg:w-[180px]`,
  `lg:pl-4`, `lg:gap-6` where the value just *grows* between anchors (no structure change) is exactly what
  `fl-*` is for — author it `fl-w-[176,180]`, `fl-pl-[…]`, `fl-gap-[…]` so it glides. Only step at a
  breakpoint when the delta coincides with a real layout-mode switch; then use `lg:fl-d-*` (or
  `fl-m-* lg:fl-d-*`), never raw px.
  - **Frozen-container squeeze:** a fixed-px container (`w-[Npx]`) wrapping fluid-gapped children
    (`fl-gap-[a,b]`) gets clipped in the tablet band because the box can't track the gliding gap — make
    the container `fl-w-[a,b]` (or drop the width and let it content-size) so it moves in lockstep.
- **Fixed-width surfaces** (drawers, modals, popovers): internals use frozen desktop values (single-anchor
  `fl-d-*` or plain px), never viewport-relative units — the panel doesn't track the viewport.
- **Mobile-only / desktop-only components** have ONE anchor. The other half often lives in a sibling
  component — check `hidden`/`lg:hidden` before treating a bare value as fixed.
- **Line-height:** unitless ratios (scale with the font automatically) — don't fluidize unless the ratio
  itself changes between anchors (then ramp the line-box in px; see model.md). **Letter-spacing:** `em`.
- **Peek scroll rails (x.5-up):** in the tablet band, scale the COUNT, not the tile — mobile keeps its
  designed x.5-up peek; at `sm+` the tile becomes a container-fraction so more tiles show while each
  stays near its design size; the desktop breakpoint restores the design layout. Keep a `.5` peek in
  every band (the scroll affordance). Count-steps at breakpoints are layout-mode changes (allowed).
- **Art text** (text composed INTO banner imagery) is column-relative, NOT `fl-text` — use
  `fl-art-text-[designPx, columnDesignPx]` and floor the COLUMN, never the element. See model.md.

## Conversion workflow

1. **Locate every sizing site.** Read the target file(s) fully. Sizes hide in template literals, in
   `className` constants (`const CARD = 'text-sm …'`), and in props (`gap=`, `labelClassName=`,
   `textClassName=`). **Never regex-codemod** — each value needs a judgment call (fluidize vs keep-breakpoint).
2. **Find `a, b` for each value.** From the design source (Figma: the value at the 360 frame and the 1440
   frame), or the existing `x lg:y` pair (x = a, y = b). A value with no `lg:` counterpart that clearly
   scales still needs both anchors — get them from the design, don't invent.
3. **Convert:**
   - Pure size/spacing that grows → `fl-<prop>-[a,b]`.
   - Same value at both anchors that should still zoom on phones → `fl-<prop>-[X,X]` (fixed but breathes in
     zone M); truly immobile (hairline/border) → `fl-<prop>-[X,X,flat]`.
   - Structure change → keep the `lg:` breakpoint (use `lg:fl-d-*` if the desktop value also scales).
   - One-layout component → single-anchor `fl-m-*` / `fl-d-*`.
   - Text into artwork → `fl-art-text-*`.
4. **Multi-value class strings must go through `cn()`** so tailwind-merge dedupes an `fl-*` class against
   any native class it overrides (`cn('p-4', 'fl-p-[16,24]')` → keeps only `fl-p`). The engine's `cn.ts`
   wiring is what makes this work; use `cn(...)`, not string concatenation, wherever an `fl-*` class can
   collide with a native one.
5. **Verify (do not skip):**
   - `bun run check:fluid` (or `bun scripts/check-fluid.mjs <files>`) — the validator; must pass.
   - Typecheck + lint.
   - Drive the real UI at **360 and 1440** and confirm pixel-parity with the design at both anchors, then
     eyeball **393 / 430 / 768 / 1024 / 1920** for smooth glide and no jump. Check 320px + 200% zoom + 200%
     root font for reflow/overflow.

## Common mistakes

| Mistake | Fix |
|---|---|
| `fl-text-[14,16] lg:fl-text-[…]` | one `fl-text` covers the whole range — no `lg:` twin |
| Stepping a pure size at `lg:` | `fl-*-[a,b]` glides it; only step for structure changes |
| `fl-*` on a font-size AND a `lg:tracking` on the same element | fine — letter-spacing/line-height MAY differ per breakpoint; only font-size must be the single fl value |
| Fluidizing across a grid↔flex switch | breaks composition — keep the breakpoint |
| Regex-replacing `text-sm`→`fl-text-[…]` wholesale | every value needs a judged `a,b`; convert by hand |
| Raw `clamp()` in a component | use an `fl-*` utility |

When something surprises you or a rule needed nuance the skill didn't cover, note it — this skill is
meant to accrue field notes over time.
