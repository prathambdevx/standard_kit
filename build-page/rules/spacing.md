# Spacing rules

> **⚠️ Fluid spacing is governed by the `fluid-system` skill (`apps/web/.claude/skills/fluid-system`).** On migrated surfaces (homepage + chrome), spacing that scales uses `fl-*` utilities (`fl-gap-[16,24]`, `fl-px-[16,24]`, single-anchor `fl-m-*`/`fl-d-*`), NOT `var(--fl-*)` tokens. The `--fl-*` guidance below is legacy reference for un-migrated pages until the purge. The rules on *which primitive* to use (gap vs padding vs margin) still apply everywhere.

Single source of truth for padding, gap, and margin usage across the platform.

---

## The three primitives

| Primitive | When to use |
|-----------|-------------|
| `gap` | Space **between siblings** in a flex or grid container — the parent owns it |
| `padding` | Space **inside** a container, between its border and its content |
| `margin` | Only for the two cases listed below |

---

## gap — default for sibling spacing

Make the parent a flex column/row and use `gap`. One value, one place, no side effects.

```tsx
{/* ✅ Parent owns the space between children */}
<section className="flex flex-col gap-5">
  <h2>Title</h2>
  <ProductRail />
</section>

{/* ❌ Child patches its own spacing — fragile */}
<section>
  <h2 className="mb-5">Title</h2>
  <ProductRail />
</section>
```

When siblings need **different gaps between them** (e.g. title→carousel is 24px but carousel→dots is 32px), use two nested flex containers:

```tsx
<div className="flex flex-col gap-6 lg:gap-8">   {/* title → inner block */}
  <p>Title</p>
  <div className="flex flex-col gap-8 lg:gap-12"> {/* carousel → dots */}
    <Carousel />
    <Dots />
  </div>
</div>
```

---

## padding — inside a container

Use `padding` for breathing room **inside** an element — section edges, card insets, button hit areas.

```tsx
{/* ✅ Section breathing room */}
<section className="px-4 py-8 lg:px-6 lg:py-12">...</section>

{/* ✅ Card inset */}
<div className="p-4 lg:p-6">...</div>
```

Do **not** use padding to push siblings apart — that belongs on the parent as `gap`.

---

## margin — two legitimate uses only

**1. Centering a block horizontally:**
```tsx
<div className="mx-auto max-w-[900px]">...</div>
```

**2. EdgeScroll bleed cancel pattern** — `EdgeScroll` handles the bleed automatically via internal CSS vars (`--es-pad`). The parent supplies `px-4 lg:px-6`; no manual `-mx-*` needed:
```tsx
{/* ✅ Parent owns px-4 lg:px-6 — EdgeScroll bleeds itself */}
<section className="px-4 lg:px-6">
  <EdgeScroll gap="gap-3">
    {children}
  </EdgeScroll>
</section>
```

**3. Standalone divider or decorative element** that sits between two siblings in a non-flex block container where different spacing is needed above and below it:
```tsx
{/* Divider needs 32px above, 48px below — gap can't express two different values for one element */}
<div className="mt-8 lg:mt-16 mb-12 lg:mb-16 h-px bg-line-light" />
```

**4. Spacing between full-bleed page sections** in a non-flex block container (e.g. `<main>`) where each section needs different spacing and making the parent flex would lose per-section control:
```tsx
{/* Each section needs different bottom spacing — gap on <main> would be uniform */}
<section className="mb-8 lg:mb-24">...</section> {/* press quotes → creators */}
```
Use `mb-` on the section that owns the visual colour of the gap (the section whose background should fill the space).

**Never** use margin to space siblings when `gap` is available. Margins on flex/grid children are always replaceable with `gap`.

---

## Responsive gaps

Spacing that simply **scales** between mobile and desktop is **fluid** — use a `--fl-<min>-<max>` token, not a `lg:` step (see `.claude/rules/styles.md` → Fluid responsive system):

```tsx
{/* 16px @360 → 20px @1440, fluid */}
<section className="flex flex-col gap-[var(--fl-16-20)]">
```

Keep the `lg:` step only when the layout **mode** changes between mobile and desktop (grid↔flex, stacked↔columns) — there the gap means different things on each side, so give each its own value:

```tsx
{/* mobile grid gap stays contained; desktop row gap is larger */}
<div className="grid gap-[var(--fl-24-40)] lg:flex lg:gap-[var(--fl-24-128)]">
```

---

## CMS-driven pages — movable blocks

When a page is built from a CMS dynamic zone (blocks the editor can reorder), the spacing model changes: **no individual block may own vertical padding**. The view owns all vertical rhythm.

### The rule

```
View:  <main className="flex flex-col gap-<N> pt-<top> pb-<bottom> lg:gap-<N> lg:pt-<top> lg:pb-<bottom>">
Block: <section className="px-4 lg:px-6">   ← horizontal padding only, zero vertical
```

- `pt-*` / `pb-*` on `<main>` = top clearance (header) + bottom clearance (footer)
- `gap-*` on `<main>` = the single inter-block spacing — one uniform value, every pair, **for that page**
- Each block component: **only horizontal padding** (`px-`, `pl-`, `pr-`). Zero `py-`, `pt-`, `pb-`, `mt-`, `mb-`

The actual `gap-*`/`pt-*`/`pb-*` numbers are **per-page**, not a fixed constant — pick whatever matches that page's Figma. What's non-negotiable is the *shape*: one `gap` value owns every inter-block space, and `pt`/`pb` own the top/bottom clearance, both on `<main>` only. For example, `gap-12 pt-24 pb-12 lg:gap-40 lg:pt-40 lg:pb-40` is what one page (Gentleman's Cloth) happens to use — a different page is free to use `gap-20 pt-24 pb-12 lg:gap-40` if its Figma calls for tighter/looser rhythm.

### Why

If a block owns `pt-24` and the block above owns `pb-20`, dragging them apart breaks the spacing — a different pair now has 44px gap while others have 0px. The gap model makes every pair identical automatically.

### RevealUp — each block wraps itself

CMS blocks self-wrap in `<RevealUp>` so the view stays a flat `renderBlocks` call with no per-block logic:

```tsx
// ✅ block component
export const MillLogos = ({ data }) => (
  <RevealUp>
    <section className="flex flex-col gap-6 lg:gap-8">...</section>
  </RevealUp>
);

// ✅ view — no per-block wrappers needed (gap/pt/pb values are this page's own — pick per Figma)
export const GentlemanClothView = ({ page }) => (
  <main className="flex flex-col gap-12 pt-24 pb-12 lg:gap-40 lg:pt-40 lg:pb-40">
    <SmoothScroll />
    {renderBlocks(page, GENTLEMAN_BLOCKS)}
  </main>
);
```

Exception: the **hero block** skips `RevealUp` (it's the LCP element — animating it delays paint).

### Anti-patterns

```tsx
// ❌ Block owns vertical padding — breaks on reorder
<section className="px-4 pt-12 pb-20 lg:pt-28 lg:pb-40">

// ❌ View adds per-block RevealUp — now the view needs to know block types
{heroBlock && <GentlemanHero data={heroBlock} />}
{fabricBookBlock && <RevealUp><FabricsCount data={fabricBookBlock} /></RevealUp>}

// ❌ Interleaved static content — non-CMS sections break reorderability
{millLogosBlock && <MillLogos />}
<ProductCarouselSection data={staticData} />   {/* hardcoded, not movable */}
{tcSplit && <MediaSplit />}
```

### Full-bleed blocks

A block whose background bleeds edge-to-edge (e.g. a warm-tinted section) uses negative margin to cancel the parent's horizontal padding, then restores it inside — same EdgeScroll bleed pattern. It still has **zero vertical margin/padding** on its outer wrapper.

---

## 4px scale (non-fluid / fixed spacing)

For spacing that does **not** scale (fixed both breakpoints), use Tailwind's 4px scale. Arbitrary values only when the Figma value is not divisible by 4.

| Figma value | Class |
|-------------|-------|
| 16px | `gap-4` / `p-4` |
| 20px | `gap-5` / `p-5` |
| 24px | `gap-6` / `p-6` |
| 32px | `gap-8` / `p-8` |
| 48px | `gap-12` / `p-12` |
| 18px | `gap-[18px]` (not divisible by 4) |
