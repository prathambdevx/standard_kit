---
name: image-optimization
description: Audit and optimize image quality, width, height, and sizes props across components to improve performance without making images blurry. Use when reviewing image performance, fixing LCP, or optimizing page load.
user-invocable: true
argument-hint: "optional file path or component name to scope the audit"
---

# Image Optimization

Audit `<Img>` and `<Picture>` usage to ensure every image loads at the right size and quality — sharp enough to look HD, small enough to not waste bandwidth.

## Core Principle

**Serve exactly what the screen needs — nothing more, nothing less.**

A 200px thumbnail doesn't need a 1200px source. A full-width hero doesn't need quality 40. The goal is: **clear at every size, fast at every connection.**

## How the Img Component Works

Before optimizing, understand the pipeline:

- **Custom loader** in `src/components/ui/img.tsx` applies **2x DPR** automatically (covers retina / most phones)
- So `width={400}` actually requests an **800px** image from the CDN
- `<Picture>` (`src/components/ui/picture.tsx`) generates srcset candidates at 0.66x / 1x / 1.5x / 2x so the browser picks the smallest variant that fills the container at the device's DPR
- Max request width is capped at **2560px**
- Default quality is **75** if not specified, but `<Img>` auto-drops to **60** when `width ≤ 120` — so tiny thumbnails/avatars don't need an explicit `quality` prop
- Shopify URLs use `&width=` and `&q=` params; others use `?w=` and `?q=`
- GIFs bypass optimization entirely (unoptimized mode)

This means: **set `width` to the CSS rendered size, not the "retina" size.** The loader handles DPR.

### How srcset is generated — `<Img>` vs `<Picture>`

**`<Img>`** — Next.js generates the srcset by calling the custom `imageLoader` for each entry in `next.config.ts` `deviceSizes: [320, 640, 750, 828, 1080, 1200, 1440, 1920]`. The loader caps each call at `width × 2`. Entries above the cap generate duplicate URLs (harmless, slight HTML bloat). The `320` entry is essential for mobile 2-col cards (160px CSS × 2 DPR = 320px) — without it the browser jumps to 640w (2× too large).

**`<Picture>`** — generates its own srcset manually via `generateCandidateWidths(targetWidth)` at `[0.66x, 1x, 1.5x, 2x]`. Four entries, all unique, no duplicates. Always clean.

### `sizes` — the single biggest performance lever

`sizes` tells the browser how wide the image will be displayed. The browser picks the matching srcset entry. Without a correct `sizes`, the browser downloads a much larger image than needed.

**`<Img>` fallback** (when `sizes` is not passed): `(max-width: ${numericWidth}px) 100vw, ${numericWidth}px`. Acceptable for single-column images. **Wrong for grid layouts** — always pass explicit `sizes` for cards in multi-column grids.

**`<Picture>` fallback**: `(min-width: 768px) ${desktopWidth}px, ${mobileWidth}px`. Uses the actual declared widths — more accurate than `100vw`.

**Grid-column `sizes` pattern for PLP cards:**
```tsx
// columns=1: 1-col mobile, 3-col desktop
sizes="(min-width: 1024px) calc(33vw - 10px), (min-width: 768px) calc(50vw - 2px), calc(100vw - 32px)"

// columns=2: 2-col mobile, 3-col desktop
sizes="(min-width: 1024px) calc(33vw - 10px), calc(50vw - 2px)"

// columns=4: 1-col mobile, 4-col desktop
sizes="(min-width: 1024px) calc(25vw - 10px), (min-width: 768px) calc(50vw - 2px), calc(100vw - 32px)"
```

Mobile 2-col saving: `calc(100vw - 32px)` → `calc(50vw - 2px)` saves ~115KB per card (150KB → 35KB at 360px viewport).

### Shared preload helper — `src/lib/preload_image.ts`

Use `preloadImage(url, width?, quality?)` to warm an image in the browser cache **before** its `<img>` tag appears in the DOM. Only use this when timing is critical (e.g. before a View Transition crossfade). For responsive images in a grid, prefer the `maxLoaded` + `<Img>` pattern which lets the browser auto-select the right srcset entry via `sizes`.

```ts
import { preloadImage } from '@/lib/preload_image';

// PDP colour swap — warm hero before crossfade fires
await preloadImage(next.images[0]?.url, heroImageWidth());

// Pass width() not a constant — computes viewport × DPR at call time
// so mobile warms the 720px variant, not the 1440px desktop cap
```

### loading / fetchPriority resolution (Img)

`<Img>` resolves `loading` and `fetchPriority` in priority order — **explicit prop wins, then `priority`-derived, then defaults**:

```
loading:        explicit loading prop  →  priority ? "eager" : "lazy"
fetchPriority:  explicit fetchPriority →  priority ? "high"  : "auto"
```

This means you can pass `fetchPriority="low"` on a below-fold image to hint the browser to deprioritise it, even without touching the `priority` prop. You rarely need this — `lazy` loading handles most cases — but it's there for fine-tuning.

### preload() in Picture with priority

When `<Picture priority>` is set, the component calls React's `preload()` from `react-dom` **before rendering**. This injects a `<link rel="preload">` into `<head>` at React's earliest opportunity.

**Why this matters for LCP:** Without it, the browser doesn't know which `<source>` variant to fetch until after CSS parses and `<source media="...">` queries resolve. With it, the preload fires immediately when the HTML arrives — the image is already in cache by the time `<picture>` renders. This directly shortens LCP.

Two separate preloads are injected — one for mobile (`media="(max-width: 767px)"`) and one for desktop (`media="(min-width: 768px)"`) — so each device only downloads its own variant.

```tsx
// Above-fold hero: Picture fires preload() for both breakpoints automatically
<Picture
  mobileSrc={hero.mobile}
  desktopSrc={hero.desktop}
  mobileWidth={390}
  desktopWidth={1440}
  mobileHeight={520}
  desktopHeight={700}
  alt="Hero"
  priority   // ← triggers preload() in <head>
/>
```

Only pass `priority` on the above-fold LCP image. Every additional `priority` adds a preload and competes for bandwidth.

### showLoader / IntersectionObserver (Img)

`<Img showLoader>` enables a spinner-gated render path that delays painting the `<Image>` until the container scrolls into view:

**How it works:**
1. An `IntersectionObserver` watches the wrapper `<div>` with a `50px` root margin (starts firing just before the container enters viewport).
2. Until `isInView` is true, only a placeholder spinner (`<InfiniteLoader />`) renders — no `<Image>` tag, no network request.
3. Once in view, the observer disconnects and `<Image>` mounts. When the image finishes loading (`onLoad`), the spinner unmounts.

**When to use it:** Galleries and image-heavy sections where you want a visual loading state on each image rather than the browser's built-in lazy load. The browser's `loading="lazy"` (the default on all non-priority `<Img>`) already defers network requests — `showLoader` adds a spinner on top of that for UX polish.

**When NOT to use it:** Above-fold images, product hero shots, any image that matters for LCP. `showLoader` delays the `<Image>` mount entirely, which would wreck LCP if used on a critical image. Use `priority` instead.

## Workflow

### Step 1: Find all Img/Picture usage in scope

```bash
# Full project
grep -rn '<Img\b\|<Picture\b' src/modules/ src/components/ src/app/ --include='*.tsx'

# Or scope to a specific module/page
grep -rn '<Img\b\|<Picture\b' src/modules/home/ --include='*.tsx'
```

### Step 2: For each image, determine optimal props

For every `<Img>` instance, answer these questions:

| Question | How to determine | What it affects |
|----------|-----------------|-----------------|
| What is the largest CSS rendered size? | Check `className` (w-*, h-*, size-*) and parent container constraints | `width` and `height` props |
| Does it change size across breakpoints? | Check responsive classes (sm:, md:, lg:, xl:) | `sizes` prop |
| How prominent is it on screen? | Is it hero/banner, product detail, thumbnail, decorative? | `quality` prop |
| Is it above the fold? | First viewport on page load | `priority` prop |

### Step 3: Apply the sizing rules

#### Width & Height

Set `width` and `height` to the **largest CSS rendered size** of the image:

| CSS rendered size | Set width to | Why |
|-------------------|-------------|-----|
| Fixed (e.g., `w-10` = 40px) | `40` | Loader sends 80px (2x) — sharp on retina |
| Responsive inside max-w-[1440px] container | Largest breakpoint size (e.g., `600`) | Loader sends 1200px (2x) |
| Fluid full-width inside max-w-[1440px] | `1440` | Loader sends 2560px (cap) — covers 1440px at 2x DPR |
| Full-bleed / full-screen (no max-width, spans entire viewport) | `1280` | Loader sends 2560px (2x DPR cap) — covers up to 2560px displays |

**Width caps by layout context:**
- **Content images** (inside `max-w-[1440px]` container): cap at `1440`. The 2x DPR loader sends 2560px (the max cap) — sharp on any screen.
- **Full-bleed images** (hero banners, full-width backgrounds with no max-width constraint): use `1280`. The loader sends 2560px (the max cap) — covers ultra-wide and retina monitors.
- **Never exceed `1280` for full-bleed or `1440` for content** — the loader caps at 2560px anyway, so anything above that is wasted (1440 * 2 = 2880, capped to 2560).

#### Sizes Attribute

The `sizes` attribute is the **single biggest performance lever**. Without it, the browser assumes the image is 100vw and downloads the largest variant.

**Always add `sizes` for responsive images.** Match it to the actual rendered width at each breakpoint:

```tsx
// Image in a 2-column grid on mobile, 4-column on desktop (1440px max-width, 120px padding)
sizes="(min-width: 1024px) 300px, 50vw"

// Full-width hero inside 1440px container
sizes="(min-width: 1440px) 1440px, 100vw"

// Fixed-size thumbnail (always 40px)
sizes="40px"

// Product card in PLP grid: 2-col mobile, 4-col desktop
sizes="(min-width: 1280px) 248px, (min-width: 1024px) 220px, 165px"
```

**When to skip `sizes`:** Only when the image has a truly fixed pixel size across all viewports (e.g., a 40px avatar).

#### Quality

Quality is the balance between clarity and file size. Use this table:

| Image type | Quality | Reasoning |
|------------|---------|-----------|
| Hero / banner (large, prominent, above fold) | 70–75 | Artifacts visible at large sizes |
| Product images (medium, detail matters for purchase decisions) | 65–75 | Users zoom/inspect these |
| Content images (blog, editorial, mid-page) | 60–70 | Viewed at medium size, slight compression fine |
| Thumbnails / avatars (< 100px rendered) | 50–60 | Small size hides compression artifacts |
| Before/after comparisons | 55–65 | Comparison needs consistency, not perfection |
| Background / decorative | 50–60 | Not the focus, behind content |
| Icons (if raster, prefer SVG) | 50–60 | Simple shapes compress well |
| Carousel items (swiped quickly) | 55–65 | Brief viewing time per item |

**Key rules:**
- **Never go below 40** — anything lower risks visible blur/banding
- **Never go above 80** — diminishing returns, massive file size increase for imperceptible gain
- **Default 75 is fine for most product/content images** — only lower it when there's a clear reason
- **When in doubt, use 65** — it's the sweet spot for most mid-size images

#### Priority

Add `priority={true}` only for images **above the fold on initial page load**:
- Hero banners
- First product image on PDP
- Logo (though usually SVG)

**Never priority-load** below-fold images, carousel items beyond the first, or lazy-loaded galleries.

### Step 4: Verify from code

Re-read each changed component and confirm:

- `width` (or `desktopWidth`) = CSS rendered size, not source/CMS size
- `sizes` breakpoints match the actual responsive layout
- No non-priority image has `loading="eager"` (don't pass it explicitly — let priority-derived default handle it)
- `quality` values fall inside the table ranges
- `fetchPriority="low"` only where you want to actively deprioritise (infinite scroll, off-screen galleries); otherwise omit it
- `showLoader` only on gallery/carousel images that need a spinner — never on LCP or priority images

If all four hold, the "Improve image delivery" sub-audits for sizing, encoding, and offscreen images will pass. (Format negotiation — WebP/AVIF — is a CDN concern outside this skill's scope.)

## Common Anti-Patterns

| Anti-pattern | Problem | Fix |
|-------------|---------|-----|
| `width={image.width}` from CMS/API data | Source image often larger than rendered size; `sizes` hint becomes wrong and Lighthouse flags "properly-size-images" | Hardcode `width` to the CSS rendered size |
| No `sizes` on responsive images | Browser downloads 100vw variant for a 200px thumbnail | Add `sizes` matching actual rendered widths |
| `width={400} height={396}` on a 40px thumbnail | Loader requests 800px image for a 40px circle | Set `width={40} height={40}` |
| `quality={75}` on every image | Wastes bandwidth on thumbnails and decorative images | Lower to 50-60 for small/decorative |
| `width={1920}` on content inside 1440px max-width | Loader request hits the 2560px cap — oversized for a 1440px container | Cap at `width={1440}` for content, `width={1280}` for full-bleed (both hit the 2560 cap at 2x DPR) |
| No `quality` prop (relying on default 75) | Fine for prominent images, wasteful for thumbnails | Explicitly set lower quality on small images |
| Same `sizes` for all images | Different grids have different column widths | Tailor `sizes` to each component's layout |
| `showLoader` on a hero or PDP first image | Delays `<Image>` mount entirely — destroys LCP | Use `priority` instead; `showLoader` is only for gallery spinners |
| `fetchPriority="low"` on a visible card | Tells the browser to stall a visible image — hurts perceived load | Only use on genuinely off-screen / infinite-scroll images |

## Audit Checklist

For each `<Img>` usage, verify:

- [ ] `width` matches largest CSS rendered size (not source image dimensions)
- [ ] `height` matches aspect ratio at that width
- [ ] `sizes` is present for any responsive image (skip only for truly fixed-size)
- [ ] `sizes` breakpoints match the component's actual responsive layout
- [ ] `quality` is appropriate for the image type (see table above)
- [ ] `priority` is set only for above-fold images
- [ ] `width` ≤ 1440 for content images (inside max-w container), ≤ 1280 for full-bleed images (both saturate the 2560px loader cap at 2x DPR)
- [ ] `width` is NOT sourced from CMS/API metadata (e.g. `image.width`) — it must be the hardcoded CSS rendered size
- [ ] `showLoader` is NOT set on any hero, PDP first image, or other LCP candidate
- [ ] `fetchPriority="low"` only on provably off-screen or infinite-scroll images — omit it everywhere else

## Output Format

### Per-image findings

Report each finding in this format:

```
**File:** `src/components/Blocks/Home/HeroSection/index.tsx:45`
**Current:** width={image.width} (CMS = 1920), height={image.height} (1080), quality=75, no sizes
**Issue:** Width sourced from CMS instead of rendered size, missing sizes attribute → browser downloads oversized variant
**Fix:** width=1280, height=720, quality=70, sizes="100vw"  (full-bleed hero saturates the 2560px cap at 2x DPR)
**Estimated saving:** ~35 KB per image load
```

### Estimating KB savings per image

Use these baselines to estimate savings. These are approximate for JPEG/WebP product and content images served via CDN:

| Change made | Typical saving per image |
|-------------|------------------------|
| Adding `sizes` (was missing on responsive image) | 30–80 KB (prevents downloading oversized variant) |
| Reducing `width` from oversized to correct rendered size | 20–60 KB (depends on how oversized) |
| Lowering quality by 10 points (e.g., 75 → 65) | 10–25 KB |
| Lowering quality by 20 points (e.g., 75 → 55) | 20–45 KB |
| Combining width fix + sizes + quality reduction | 50–120 KB |

**How to estimate:** For each image, pick the applicable row(s) and sum. Multiply by how many times the image appears on the page (e.g., 8 product cards in a grid = 8x the per-image saving).

### Page-level savings summary

After listing all per-image findings, **end the report with a page-level savings summary**:

```
## Savings Summary

| Page / Section | Images affected | Est. saving per image | Total est. saving |
|---------------|----------------|----------------------|-------------------|
| PLP first viewport (8 product cards) | 8 | ~45 KB each | ~360 KB |
| Home hero + featured section | 3 | ~60 KB each | ~180 KB |
| PDP gallery (5 images) | 5 | ~30 KB each | ~150 KB |
| Blog listing (6 cards) | 6 | ~25 KB each | ~150 KB |

### Total estimated savings: ~840 KB across audited pages

**Impact context:**
- Mobile 4G (~5 Mbps): saves ~1.3s of download time
- Desktop broadband: saves ~0.2s, but reduces CDN egress cost
- Lighthouse "Properly size images" diagnostic: likely resolves X of Y flagged images
```

**Rules for the summary:**
- Group findings by page or section, not by individual file
- Multiply per-image saving by the number of images in that section
- Always include a **total** row at the bottom
- Add the **impact context** section showing real-world time savings
- Use conservative estimates — round down, not up
- Time savings formula: `total_KB / (connection_speed_KBps)` where 4G ~ 625 KB/s, 3G ~ 50 KB/s
- If a page has many below-fold images (lazy loaded), note that the saving applies as the user scrolls, not all at initial load
