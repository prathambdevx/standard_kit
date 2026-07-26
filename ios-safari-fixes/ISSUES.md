# IOS issues:

Running log of iOS-Safari-only bugs hit in real projects and how they were fixed. Add a bullet each time a new one surfaces. (Deeper explanations of the recurring ones live in `SKILL.md`.)

- **Footer FAQ accordion — payment icons flicker on open/close.** The reported symptom is the
  payment SVG icon row visibly re-rendering/shimmering while the accordion above it animates its
  height. Confirmed fix: promote that row to its own GPU layer with `transform-gpu`, so the browser
  composites it instead of re-rasterizing the SVGs every reflow frame (rule 7 below).
  A scroll/layout-jerk theory (iOS re-clamping `window.scrollY` frame-by-frame as the accordion's
  height animation changes document height) was investigated as a possible second cause and a RAF
  scroll-stabilizer was built for it — but on closer inspection this was never a real, reproduced
  issue; the actual complaint was always the icon flicker. The scroll-stabilizer was removed. Don't
  reintroduce it without an actual reproduced scroll-jerk report to point at.

- **Full-viewport elements resize/jump as the URL bar hides on scroll — use `svh`, not `dvh`/`vh`.** `100dvh` tracks the live viewport, which iOS continuously resizes as the URL bar collapses; anything sized in `dvh` grows/shrinks mid-scroll (fullscreen lightbox, hero pinned to one screen, "cap at viewport" modal). `svh` = smallest viewport height, stable through the whole URL-bar animation. Use `dvh` only when you actually want live tracking.
  ```
  ❌ max-h-[calc(100dvh-150px)]      style={{ maxHeight: 'calc(100dvh - 150px)' }}
  ✅ max-h-[calc(100svh-150px)]      style={{ maxHeight: 'calc(100svh - 150px)' }}
  ```

- **Full-screen customizer/size-guide drawer breaks when opened while the address bar is already
  collapsed (Android Chrome) — and the naive `dvh` fix reintroduces the iOS toolbar jitter rule 4
  exists to prevent.** Reported symptom: opening a full-screen mobile drawer while previously
  scrolled (Chrome's toolbar hidden) left a gap at the bottom, background page peeking through —
  because the drawer was sized with `svh` (smallest/toolbar-visible viewport), shorter than the
  real, current (toolbar-already-collapsed) screen. Confirmed fix: `useLockedViewportHeight` —
  measure `window.innerHeight` once in JS when the drawer opens, freeze it as a static CSS var
  (`--locked-vh`), fall back to `100svh` only for the instant before that measurement lands (rule 8
  in `SKILL.md`). Do NOT "fix" this by switching the base unit to `dvh` — that removes the Android
  gap but brings back the live-recalculating iOS jank documented in rule 4/the entry below.

- **Follow-up to the entry above: a single height measurement wasn't enough — the customizer's
  footer buttons went off-screen on iOS after `useLockedViewportHeight` shipped.** Opening the
  overlay also locks body scroll (`position: fixed` pin, rule 5), and pinning `<body>` that way on
  iOS Safari commonly snaps the toolbar back to fully expanded a moment *after* the hook's first
  synchronous read — the real viewport then shrinks below the frozen height, pushing a bottom-pinned
  footer below the fold. Confirmed fix: the hook now also listens for a `visualViewport`/`window`
  `resize` while active and re-measures. This does not reintroduce `dvh`'s per-frame jank — the
  overlay's own scroll lock means nothing else can trigger that listener while it's open short of a
  real rotation, so it only ever settles that one late correction (rule 8, updated).

- **A `position: fixed` bottom bar (nav, CTA) can detach and render at a stale mid-page position
  after the page grows a lot below the fold — e.g. PLP infinite-scroll pagination.** Not a viewport-
  height bug, not a repaint-shimmer bug (rule 7's original case) — a third, separate iOS WebKit
  quirk where the browser fails to re-composite a fixed layer at the correct position after a large
  async DOM mutation, until something forces a re-anchor. Confirmed fix: the same `transform-gpu` +
  `backface-hidden` layer promotion as rule 7, applied permanently to the fixed bar (rule 7,
  extended) — reported on a real iPhone browsing a long, infinite-scrolling product list; this is
  a WebKit-specific compositing quirk, so it's iOS Safari only (not confirmed on Android Chrome).

- **Bottom bars need `env(safe-area-inset-bottom)` — but the viewport must opt in, and apply it exactly once per chain.** Fixed/sticky bottom bars, sticky CTAs, drawers and bottom-sheet modals must clear the iPhone home indicator, or they sit under it.
  1. The inset only returns real values when the viewport opts into the notch. In Next set it once in the root `layout.tsx`:
     ```ts
     export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };
     ```
  2. Then pad the bar: `pb-[calc(<base>+env(safe-area-inset-bottom))]` — e.g. `pb-[calc(16px+env(safe-area-inset-bottom))]`. Repo examples: `drawer.tsx`, `mobile_bottom_nav`, `size_guide_drawer`, cart/orders/gift-card sticky bars.
  3. **Apply it once per ancestor chain** — if a wrapper adds `pb-[env(safe-area-inset-bottom)]` and its child also adds `pb-[calc(32px+env(safe-area-inset-bottom))]`, the inset double-stacks and over-pads the bar. Only one element in the stack applies it.

- **A banner's image + copy, stacked in one `grid-area: 1/1` cell, split into TWO rows on some iPhones —
  copy rendered in a band ABOVE the artwork, overlapping the section above it.** Present from first paint
  (the reporter never saw it shift on scroll), only on some iPhones, and not reproducible in any desktop
  browser or in Playwright at any viewport. Cause: the `<section>` declared BOTH `@container`
  (`container-type: inline-size`) and the layout (`grid grid-cols-1 grid-rows-1`), while its image child's
  height was `min-h-[calc(80.11cqw+360px)]` — a `cqw` of that same section. Grid track sizing consumes
  child sizes, so the tracks depended on the very box establishing the container; WebKit doesn't resolve
  that cycle reliably. **The misleading part: container queries were NOT broken on the device** — every
  horizontal `cqw` measured correct (copy column width, `cqw` paddings, `max-width`s), only vertical
  placement was wrong, so "the container works" proves nothing here. Confirmed fix: split them —
  `@container` stays on the section with margins/position only, `grid` + the row templates move to a
  nested block-level `<div>` wrapping the children (identical width, so every `cqw` resolves unchanged;
  a pure restructure with no design values touched) (rule 9 below). Diagnosed without device access by
  grepping for the combination: the only other component pairing `@container` with `grid` had no
  `cqw`-derived height and never broke, which isolated the cause. Rejected: `absolute inset-0` for the
  copy (drops it out of row sizing, so long copy overflows the art instead of growing the box) and
  `h-full` on the copy (the symptom is wrong *row placement*, which height-within-a-row cannot fix).
