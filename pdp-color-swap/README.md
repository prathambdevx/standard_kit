# pdp-color-swap

The in-place colour-swap engine for a PDP (product detail page): tapping a colour swatch
swaps the whole product — gallery, price, info, accordions — without a route remount, a
scroll reset, or a loading skeleton, and crossfades the gallery via the browser View
Transitions API. Includes the two gallery variants this was built against (a full
grid+carousel+lightbox gallery, and a simpler single-image-with-arrows variant for a
"paired product" section) so you have a real reference for wiring either shape.

## Why this exists as one bundle

The swap, the URL sync, the prefetching, and the gallery crossfade are one coupled
system — pulling just the hook without the gallery's remount trick (or vice versa) gets
you a working colour switch with a hard cut instead of a crossfade, which defeats the
point. Copy the whole folder, then trim what your PDP doesn't need (e.g. drop
`pair_product_hero` if you only have one gallery layout).

## Files

| File | Role |
|---|---|
| `hooks/useColorSwap.ts` | The engine. Owns the active product, fetches the sibling on tap (TanStack Query), preloads its hero image before committing, `history.replaceState`s the URL, and commits the swap inside `startStateTransition` so the gallery crossfades instead of jump-cutting. Also idle-prefetches the first few visible swatches' product JSON + hero image so a cold first tap still resolves near-instantly. |
| `components/page_color_swap_provider/index.tsx` | Thin context wrapper — wrap your whole PDP view in this once so every descendant (gallery, swatches, info) reads the same active product via `useColorSwapContext()`. |
| `components/product_hero/index.tsx` | Reference consumer: reads `useColorSwapContext()`, derives gallery/info/accordion view-models from the active product, and passes `swapKey={product.handle}` to `Gallery` — the prop that makes the crossfade trick work (see below). |
| `components/gallery/*` | The primary gallery: `index.tsx` (orchestrator), `desktop_grid.tsx` (static stacked grid — no remount needed, it just re-renders with new image `src`s), `mobile_carousel.tsx` (the piece that matters — re-keys the carousel on `swapKey` so it remounts cleanly under the view transition, see the comment inline), `lightbox.tsx` (fullscreen viewer, no color-swap awareness needed), `gallery_badge.tsx` (small "New"/"Sale" chip). |
| `components/pair_product_hero/index.tsx` | Second gallery variant for a simpler "shown alongside another product" layout — single image + prev/next controls, swipeable on mobile. Shows the same pattern at its smallest: every index change goes through `startStateTransition(() => setCurrent(...))`. |
| `components/color_swatch_grid/index.tsx` | The swatch row. On tap: analytics fire, then `swap.onSelect(handle)` — no navigation, `useColorSwapContext` handles the rest. Also handles the collapsed "+N more colours" state and prefetches those hidden swatches once expanded. |

## The crossfade trick (read this before wiring your own gallery)

A browser view transition crossfades between whatever the DOM looked like right before
`document.startViewTransition`'s callback ran and right after. For a swap to read as a
clean crossfade rather than a flash, the "after" state has to already be settled and
painted the instant React commits — which means an embla/carousel-style gallery has to
**remount** on a product swap, not just receive new props, so it initializes back at
slide 0 in the plain, un-animated CSS flow the transition can snapshot cleanly. That's
what `key={swapKey}` on `mobile_carousel.tsx`'s `<Carousel>` buys you — see the comment
above it. If you build a different gallery, keep this constraint: whatever shows the
"current" image needs a stable key you bump on swap, or the transition will crossfade a
half-initialized carousel mid-animation.

## What's project-specific — adapt before copying in

This was pulled from a Shopify + custom BFF storefront, so it carries some assumptions:

- **`useColorSwap.ts`** calls `storeSdk.products.get(handle)` (a typed BFF client) and
  assumes a `BffProduct` shape with `colorSwatches`, `images`, `handle`. Swap in your own
  data-fetch call and product type; the surrounding logic (dedup by request id, prefetch,
  URL sync, view-transition commit) is data-source agnostic.
- **`startStateTransition`** comes from this kit's `ui-components/utils/view_transition.ts`
  — copy that in too if you haven't already (it's a dependency of every file here that
  changes the active image/product).
- **Import aliases** (`@/components/ui/...`, `@/lib/...`, `@/assets/icons/...`,
  `@/types/...`) point at this project's own atom library / icon set / analytics module —
  rewrite them to your project's equivalents (or use this kit's `ui-components/` for the
  `Button`/`Img`/`Alink` atoms these files expect).
- **`track.pdp.colorSelect` / `track.pdp.arrow`** (analytics calls in
  `color_swatch_grid` and `lightbox`) are calls into a project-specific analytics
  wrapper — drop them or point at your own event layer.
- **`useBodyScrollLock`** (used by `lightbox.tsx`) is a small custom hook that locks
  `<body>` scroll while a fullscreen overlay is open — bring your own or swap for
  whatever your project already uses for modals/drawers.

## Not covered here

This bundle doesn't include a drawer/dialog — the PDP gallery isn't a modal, so the
"drawer stays closed during a view transition" guard pattern documented in
`ui-components/README.md` (Dialog-safe usage) doesn't apply here. If you're triggering a
`startStateTransition` from inside an open dialog elsewhere in your app (a tabbed drawer,
a modal with a state-driven view), read that section — the failure mode there is
different (a transition can make an open dialog wrongly read as dismissed) and needs the
ref-guard, not the remount-key trick above.
