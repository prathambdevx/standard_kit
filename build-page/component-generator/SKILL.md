---
name: component-generator
description: Generate one BSC component (type + data + component) from CSS, Figma MCP, or both. Use when creating new components from design specs.
user-invocable: true
---

# Component Generator

Generate a single feature section with three files: type, data, component.

## Usage

Invoke with: name, category, and source material. Best results when both CSS and Figma MCP URL are provided.

## Inputs

| Input | Format | Purpose |
|-------|--------|---------|
| Name | snake_case file (`hero_section`); PascalCase identifier (`HeroSection`) | File path + export |
| Category | lowercase: `home` / `common` / `pdp` / `plp` / `blocks` / `layout` | Folder under `src/components/` |
| CSS dump | Desktop + mobile CSS (Figma "Copy CSS") | Layout, structure, responsive behavior |
| Figma URL | `figma.com/design/<key>/...?node-id=<id>` | Exact tokens, SVGs, padding, gap values |

**Use both when possible** — CSS gives accurate layout, Figma gives accurate tokens and SVGs.

## File paths

**Read `.claude/rules/folder_structure.md` first.** It defines path templates for type, data, component, SVG icon, atom, and route locations. Use only those paths.

If the file does not exist (new project), bootstrap it: scan `src/` to detect the convention, write the file, then proceed. After bootstrap, the file is the source of truth — never re-detect or auto-rewrite on subsequent runs.

## Source-handling rules

### When Figma URL is provided

**Always delegate to `figma:figma-use` skill** before generating. It loads required Figma MCP prereqs.

Then extract via Figma MCP:

| Need | Tool |
|------|------|
| Exact colors, typography, spacing | `get_variable_defs` + `get_design_context` |
| Component structure | `get_design_context` |
| **SVGs** (icons, logos, illustrations) | `get_design_context` returns vector data — copy SVG markup exactly |
| Visual reference for QA | `get_screenshot` |

**Never approximate SVGs.** If Figma is provided, the exact SVG markup is available. Use it verbatim. If Figma is not provided and the design has SVGs, ask the user for the Figma URL — do not guess.

### When CSS only is provided

- Parse `/* Frame ... */` headings for sections
- Use `order:` values for vertical flow
- Note in the plan: "SVG icons need Figma source — placeholder used" so the user knows to swap them in

### When both are provided

| Source | Use for |
|--------|---------|
| CSS | Section order, layout structure (flex/grid), responsive behavior, breakpoint values |
| Figma | Colors → BSC tokens, typography utilities, exact padding/gap values, SVG markup, image dimensions |
| Figma screenshot | Visual reference for the QA step (compare side-by-side) |

CSS wins on layout. Figma wins on values.

---

## Project atoms

All atom names, imports, props, and Button variants live in `.claude/rules/styles.md` (UI atoms + Button variants sections). Read it before generating any component.

If a needed atom or variant doesn't exist, create it in `src/components/ui/` and document it in `styles.md` first — then use it.
```

---

## Accuracy checklist (before writing)

1. **Create-before-use** — follow the `components.md` rule: missing icon/atom/variant/token/hook? Create it in the right location first, then import.
2. **Colors** — every color mapped to a token. No hex, no raw palette classes.
3. **Typography** — every text uses a `text-*` utility. Never inline `font-size + line-height + letter-spacing`.
4. **Spacing** — Tailwind scale (`p-8` not `p-[32px]`). Arbitrary `[Xpx]` only when not divisible by 4.
5. **SVGs** — exact markup from Figma when provided, asked-for when not. Never approximated.
6. **Atoms** — Button / Img / Picture / Alink / EdgeScroll used, no raw HTML.
7. **Container** — use the project's standard container pattern from `components.md` Layout rule. Always scope max-width with `2xl:` prefix.
8. **Carousel** — `<EdgeScroll>` alone (plain native overflow scroll) for any horizontal row of cards. `useHorizontalScroll` is retired — never use it.
9. **Image aspect ratios** — when mobile and desktop use different proportions of the same image (not a different source), use a single element with two responsive aspect classes: one mobile ratio, one `lg:` ratio. **Both must be the exact rendered pixel dimensions from the design at that breakpoint — never a reduced/simplified fraction** (`3/4`, `4/3`, `16/9`). Read the actual width/height off the Figma frame (or the CSS box) at each breakpoint and use those literal numbers as-is:
   ```tsx
   // ✅ exact design pixels per breakpoint
   className="aspect-[342/560] lg:aspect-[684/560]"

   // ❌ simplified to a common ratio — loses the actual design proportions
   className="aspect-[3/4] lg:aspect-[16/9]"
   ```
   A reduced fraction is only correct if it happens to exactly equal the design's real ratio — don't simplify to "the nearest clean ratio" as a shortcut; always use the literal `width/height` pair from the source at each breakpoint. Only reach for `hidden`/`block` swapping when the image *source* itself differs between breakpoints (not just its crop).
10. **Cards in a row with a pinned footer** — for cards sitting side-by-side in a grid (a row of stores/products/features where each has a CTA or meta row that must line up across the row), make the card a `flex flex-col` and pin the footer row with `mt-auto`. A normal `grid grid-cols-2` already stretches both cards in a row to equal height (`align-items: stretch` is the default), and `mt-auto` then drops the footer to the bottom so footers align — while a row of equally-short cards stays tight with no gap (no slack for `mt-auto` to consume). Use a flat `grid` and let DOM order pair the cards; never manually chunk into pairs, and never use `subgrid` or fixed heights for this. Guard optional content blocks (`{(a || b) && <p>…</p>}`) so a missing field doesn't leave a stray `<br/>` or empty node that breaks alignment.

---

## Placeholders (TEMP only — mark with comment)

```ts
// Image — TEMP: replace with real asset
HERO:   "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1600&h=900&fit=crop"
CARD:   "https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=800&h=600&fit=crop"
AVATAR: "https://images.unsplash.com/photo-1502685104226-ee32379fefbe?w=200&h=200&fit=crop"

// Video
VIDEO:  "https://www.youtube.com/embed/dQw4w9WgXcQ"
```

---

## Steps

1. **Grep** `src/components/<category>/` for similar components → reuse if ≥80% match.
2. **If Figma provided** — invoke `figma:figma-use`, extract tokens + SVGs + structure.
3. **If CSS provided** — parse `/* Frame ... */` for structure.
4. **Cross-reference** layout (CSS) with values (Figma) when both available.
5. **Design** data contract → simple names (`title`, `items`, `image`, `cta`).
6. **Write** type file.
7. **Write** data file (use placeholder URLs from above if assets not provided).
8. **Write** component file.
9. **Self-check** against the Accuracy checklist above.
10. **Output build report** (see format below).

---

## Build report (final output)

After generating, return a structured report so the user can audit at a glance:

```
✓ Generated: <Name> (src/components/<category>/<name>/index.tsx)

Files written
- src/types/components/<category>/<name>.ts
- src/data/<name>/index.ts
- src/components/<category>/<name>/index.tsx

New assets created
- src/assets/icons/chevron_left.tsx       (extracted from Figma)
- src/assets/icons/chevron_right.tsx      (extracted from Figma)

styles.md / button.tsx changes
- Added Button variant: pill-outline
- Added color token: --color-line-soft

Atoms used
- <Button variant="solid">  ×2
- <Img>                      ×4
- <EdgeScroll>               ×1

Open questions (need user review)
- Trust badges row: ambiguous — built as <EdgeScroll>, but could be a static grid

Import snippet for the route
import { <Name> } from '@/components/<category>/<name>'
import { <NAME>_DATA } from '@/data/<name>'
```

Skip empty sections. If nothing was created/changed in a category, omit that header.

---

## Template

```tsx
// src/components/<category>/<snake_name>/index.tsx
import type { NameData } from '@/types/components/<category>/<snake_name>'

export const Name = ({ data }: { data: NameData }) => (
  <section className="px-4 py-8 lg:px-[120px] lg:py-16 2xl:mx-auto 2xl:max-w-[1440px] 2xl:px-0">
    <h2 className="fl-text-[28,28] font-normal leading-none">{data.title}</h2>
  </section>
)
```

---

## Git Safety

Never commit, push, pull, or modify git config. All changes stay uncommitted.
