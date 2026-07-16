---
name: build-page
description: Build a complete page from CSS, Figma MCP, or both — splits the design into sections and generates each via component-generator. Use when constructing a new route from design specs.
user-invocable: true
---

# Build Page

Build a full page: ask for inputs, plan sections, generate each, integrate into route.

## Step 0 — Load folder structure

Before anything else, read `.claude/rules/folder_structure.md`. It defines where to place every generated file (type, data, component, SVG, route).

If the file does not exist, this is a new project — bootstrap it by scanning `src/` to detect the existing convention (or use the BSC defaults if nothing is there), then write the file. After bootstrap, the file is the source of truth — never re-detect on subsequent runs.

---

## Step 1 — Ask for inputs

When invoked, the first response is always:

> **What do you have?**
> 1. **Figma MCP URL** — exact colors, typography, padding, gap, and SVGs
> 2. **CSS dump** — accurate layout, section order, responsive structure
> 3. **Both (recommended)** — pixel-perfect: CSS for layout, Figma for values + SVGs
>
> Paste whatever you have. Both give the best result.

Use `AskUserQuestion` to collect:
- Route path (e.g. `src/app/(shop)/men/page.tsx`)
- Component category (e.g. `Home`, `PLP`, `PDP`)
- Input source — `Figma`, `CSS`, or `Both`
- Then the actual Figma URL and/or CSS content

Do not proceed until at least one source is provided.

---

## Step 2 — Read the layout

Before listing sections, read the app's layout file(s):

```bash
# Find which layout covers this route
src/app/layout.tsx
src/app/(shop)/layout.tsx
```

**Skip any section that's already rendered by a layout**: `<Header>`, `<Footer>`, `<Nav>`, breadcrumb, banner bars, cookie consent.

Output to the user: "Layout provides: Header, Footer. Skipping these. Building only: …"

---

## Step 3 — Parse the source

**CSS only:**
- Split by `/* Frame ... */` headings
- Use `order:` for vertical flow
- Extract desktop + mobile per section

**Figma only:**
- Invoke `figma:figma-use` first (mandatory before any Figma MCP call)
- Use `get_metadata` to get the page node structure
- Use `get_design_context` per section for tokens, structure, SVG markup

**Both:**
- Use CSS for the section list and order
- For each section, fetch its Figma node via `get_design_context` for accurate tokens
- Cross-reference: CSS gives `padding: 32px` → confirm with Figma to convert to `p-8`
- For SVGs/icons: always pull from Figma context, never from CSS

---

## Step 4 — Plan (before any code)

Present the section plan to the user:

```
Layout (already provided): Header, Footer
Skipping these.

Sections to build:
1. hero_section (home)
   - Source: CSS + Figma node 1:234
   - Notes: Hero with CTA, video background
   - Reuse: None (new)
   - SVGs needed: ArrowRight (already exists in src/assets/icons/)

2. product_carousel (home)
   - Source: CSS + Figma node 1:345
   - Notes: Horizontal product row → <EdgeScroll>
   - Reuse: None (new)
   - SVGs needed: ChevronLeft, ChevronRight (NEW — extract from Figma)

3. category_strip (home)
   - Source: CSS only
   - Notes: Horizontal category row → <EdgeScroll>
   - Reuse: None (new)
   - SVGs needed: None
```

Confirm with the user before generating.

---

## Step 5 — Generate sections

For each section, invoke `/component-generator` with:
- Name (snake_case + PascalCase pair)
- Category
- CSS snippet for that section
- Figma node ID if available

Run in parallel when there are 3+ independent sections. The component-generator skill handles atoms, tokens, SVG extraction, and accuracy checks.

---

## Step 6 — Integrate into the route

**Pages stay flat — only `<Component data={...} />` calls and optional dividers. No padding wrappers, no per-section `<section>` shells.**

**Dividers are optional.** Add `<hr className="section-divider" />` between sections **only when the Figma design clearly shows a divider line**. If the design has no visible line between two sections, render them back-to-back without an `<hr />`.

**For all padding, gap, and margin decisions — read `.claude/rules/spacing.md` before writing any spacing class.** It defines exactly when to use each primitive, including the special case of full-bleed page sections in a non-flex `<main>`, and the **CMS-driven pages — movable blocks** rule for pages built from a dynamic zone (view owns vertical gap, blocks own horizontal padding only).

**Anti-pattern — never wrap a component to add padding:**

```tsx
// ❌ Page wraps a component to add padding
<section className="px-4 py-10 lg:px-[120px]">
  <ProductCarousel data={PRODUCT_CAROUSEL_DATA} />
</section>
```

If `ProductCarousel` needs that padding, it belongs inside `ProductCarousel`'s own root element.

**Composite layouts (e.g. PDP hero with gallery + info column):** if multiple components share a single layout (flex/grid/sticky), extract the whole composition into a parent component (e.g. `ProductHero`) that owns the layout and renders the children. The page should never inline a multi-column flex wrapper.

**Do not** render `<Header>` or `<Footer>` here — they come from the layout.

---

## Step 7 — QA

Run `/qa-fix` on the route at 320px, 768px, 1024px, 1440px, 2560px.

If Figma screenshot is available, compare side-by-side per section.

---

## Step 8 — Build report

Aggregate every section's build report from `component-generator` into one page-level report:

```
✓ Page built: src/app/<route>/page.tsx

Sections (3)
- hero_section (home)            6 files
- product_carousel (home)        4 files + 2 SVGs
- category_strip (home)          3 files

Skipped (already in layout)
- Header, Footer

New assets created
- src/assets/icons/chevron_left.tsx
- src/assets/icons/chevron_right.tsx

styles.md / button.tsx changes
- Added Button variant: pill-outline
- Added color token: --color-line-soft

Open questions (need user review)
- product_carousel: card width fallback at 320px feels tight — confirm

Atoms used across this page
- <Button>     ×4
- <Img>        ×9
- <EdgeScroll> ×2
- <Alink>      ×6
```

Then ask: "Compare against Figma per section, or finish?"

---

## Rules

All component conventions are in `.claude/rules/components.md` — naming, atoms, scroll, layout, styling. Follow them.

Spacing rules (padding vs gap vs margin, when to use each, responsive gaps) → `.claude/rules/spacing.md`. Read this before placing any spacing class.

Detailed atom APIs (Button variants, Img/Picture/Alink props) → `component-generator` skill.

### Recurring failure modes to prevent

| Past mistake | Fix |
|--------------|-----|
| Recreated `<Header>` in page.tsx | Step 2 — always read layout.tsx first and skip what's already there |
| Approximated SVGs because only CSS was given | Step 1 — explicitly ask for Figma URL when icons exist |
| Hex colors leaked into output | component-generator Accuracy checklist enforces token-only colors |
| Inline `font-size + line-height` instead of `text-*` utility | component-generator enforces typography utilities |
| Used `p-[32px]` instead of `p-8`, or wrong primitive (margin vs gap vs padding) | `.claude/rules/spacing.md` — read before any spacing class |
| Bare `<button>` / `<a>` / `next/image` | components.md Atoms table |
| Horizontal card row without `<EdgeScroll>` | components.md Edge scroll rule |
| Side-by-side cards whose CTA/footer rows don't line up (or a gap appears when both are short) | component-generator Accuracy checklist #10 — `flex flex-col` card + `mt-auto` footer in a flat `grid`; no chunking, subgrid, or fixed heights |
| Wrapped a component in `<section className="py-* px-*">` on the page | Step 6 — pages are flat. Padding goes inside the component's root, never on the page wrapper |
| Inlined a multi-column flex/sticky layout on the page | Step 6 — extract composite layouts into a parent component (e.g. ProductHero) |
| Used absolute positioning to bleed a background across section boundaries | Use `pb-[Npx]` on the source section to extend its background, then `-mt-[Npx]` on the next section to overlap into that zone. Wrap the two sections in a `gap-0` div so the gap doesn't add extra space. Only use absolute positioning when the bleed is decorative (no layout impact). |

---

## Success

- No TypeScript errors
- Stable 320px → 2560px
- Every color/typography/spacing maps to a token
- Every SVG extracted from Figma exactly (or asked-for explicitly)

---

## Git Safety

Never commit, push, pull, or modify git config. All changes stay uncommitted.
