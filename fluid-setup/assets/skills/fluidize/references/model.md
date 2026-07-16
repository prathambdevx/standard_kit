# The fluid model — math and why (decision log)

> **Interactive demo + full evidence:** open `assets/docs/fluid-scaling.html` (a single self-contained
> page — live curves for all three candidate models, the field data, and the rendered-size tables).
> The original design spec (problem statement, alternatives red-teamed, decisions) is
> `assets/docs/fluid-rebuild-design.md`.

The model is **locked**. The math lives in ONE place — `scripts/fluid-math.mjs` —
imported by three consumers that can never disagree: the plugin (`tailwind-plugins/fluid.js`,
emission), the validator (`scripts/check-fluid.mjs`, validation), and the invariant tests
(`scripts/fluid-math.test.mjs`). Never fork the math into a component or a second copy.

## Formulas

Every scalable value is two Figma numbers: `a` (the value @360px viewport) and `b` (@1440px).
For `a ≤ b`, all constants are emitted rem-anchored (px ÷ 16) for WCAG 1.4.4 zoom safety:

```
cap   = min(4/3 · a, b)                                   (capAt = 360·cap/a ≤ 480 always)
M(vw) = clamp(a, a·vw/360, cap)                           vw < 480   (zone M — proportional zoom)
G(vw) = cap + (b − cap)·(vw − 480)/960                    480 ≤ vw < 1440   (zone G — linear glide)
W(vw) = b·(1 + 0.5·(min(vw,1920) − 1440)/1440)            vw ≥ 1440   (zone W — damped, max ×1.167)
```

- **Inverted** (`a > b`, value shrinks as viewport grows): a single linear ramp 360→1440, frozen outside.
- **Flat** (`fl-*-[X,X,flat]`): a constant — never scales. Hairlines, 1px borders, alignment constants only.
- **Fixed** (`a === b`, no `flat`): immobile for free — `min(4/3·a, b)` with `a===b` gives `b`, so it never moves.

## Why each piece is what it is (do not "fix" these without reading)

- **`min(4⁄3·a, b)`, not `4⁄3·a`:** a naive zone-M cap of `4⁄3·a` overshoots for fonts (where `b` is
  close to `a`) — 14px text would render ~18.7px on phones, then *drop* at 768 to rejoin the ramp.
  The `min` with `b` makes overshoot impossible and makes fixed values (`a = b`) immobile for free.
- **Proportional zone M (not a shallow global ramp):** a value must zoom with the phone — 12px@360
  should be ~14.33px@430 (`12·430/360`). A single 360→1440 line gives only ~14.1px@430 for a 14→16
  token — reads "too small on big phones."
- **Continuity by construction (no 768 jump):** zone G starts exactly where M ends. This must hold at
  NON-default root font sizes too — a rem-bound zone M meeting a px-media-query zone G floor jumps at
  480 for a 20px-root user. That's why the shared math module (not the plugin) owns the composition,
  and why the invariant tests check monotonicity + continuity at 16/20/24px roots.
- **Damped ×1.167 wide zone (not freeze, not ×1.333):** premium storefronts overwhelmingly freeze type
  past 1440. A full ×1.333 "scale to the monitor" reads too large at 1920; a hard freeze wastes the
  extra pixels. Damped half-strength (`WIDE_FACTOR = 7/6`) restores the intended visual angle on a
  larger physical display without ballooning. Frozen beyond 1920.
- **`b ≤ 4·a` (MAX_GROWTH):** beyond 4× the `min()` composition breaks. A token that needs to grow more
  than 4× is not one fluid value — art-direct it (two single-anchor values across a layout switch) or
  flat it. The validator throws on this.
- **Font WCAG cap (`WIDE_FACTOR·b ≤ 2.5·a`):** WCAG 1.4.4 — a font's largest rendered size must stay
  ≤ 2.5× its smallest, or zoom/reflow breaks. The validator throws on font tokens that violate this.
- **`a === 0` is legal for spacing, never for fonts:** a 0px gap/padding fades in cleanly from 360; a
  0px font is invisible and inaccessible. The math skips the growth/WCAG guards for `a===0` spacing
  (any b>0 is "infinite" growth from 0, which is a legitimate "invisible on mobile" anchor, not a
  runaway) but throws for a 0-anchored font.

## Single-anchor variants (one layout, not a fabricated pair)

A component that only ever renders in one layout has ONE anchor, not two:

- **`fl-m-<prop>-[n]`** — mobile-only: the zone-M law alone (proportional, capped 4⁄3). For an element
  that only exists below the desktop breakpoint (e.g. a mobile-only header/bar).
- **`fl-d-<prop>-[n]`** — desktop-only: frozen at `n` to 1440, damped ×1.167 wide. For an element that
  only exists at `lg+`.

The two halves of a responsive pair often live in *sibling* components (`Header` vs `MobileHeader`) —
check `hidden` / `lg:hidden` before treating a bare value as fixed.

## Art text (column-relative) — text composed INTO artwork

Overlay headlines/subtitles that are part of a banner image scale with their **copy column**, not the
viewport. `fl-art-text-[designPx, columnDesignPx]` emits a bare `cqw` (`designPx/columnDesignPx · 100`)
with a px fallback — no clamp, because the column's own `width: max(Ncqw, floorPx)` is the single clamp
the whole group needs.

- **The asymmetry principle:** a floor on an *individual* element (its font stops shrinking while its
  column keeps shrinking) grows that element relative to its neighbors → collision. A floor on the
  *column* (its own `width: max()`) holds every element's proportion to every other constant, because
  they all read `cqw` off the same frozen column → no collision. **Floors live on the column only.**
- The copy column is a `container-type: inline-size` box. A query container can't size against its own
  established context — never put a property that reads `cqw`/`cqh`/`cqmin` (gap, padding) on the SAME
  element that declares `container-type`; put only sizing/position there, and read its size from a nested child.
- CTAs/buttons on the same banner stay on the normal `fl-*` law (tap targets must not shrink with the art).

## Why a custom plugin (not a clamp library)

Off-the-shelf fluid/clamp plugins emit only a single linear `clamp()` — they cannot express the
three-zone M/G/W curve, the `min(4⁄3·a,b)` overshoot fix, per-value branching (flat/inverted), or the
WCAG/growth caps as build-time literals. The Tailwind-v4-native `@utility --value()` API compiles but
loses build-time literal clamps and per-value branching. Hence the small custom plugin + shared math module.
