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

- **Bottom bars need `env(safe-area-inset-bottom)` — but the viewport must opt in, and apply it exactly once per chain.** Fixed/sticky bottom bars, sticky CTAs, drawers and bottom-sheet modals must clear the iPhone home indicator, or they sit under it.
  1. The inset only returns real values when the viewport opts into the notch. In Next set it once in the root `layout.tsx`:
     ```ts
     export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };
     ```
  2. Then pad the bar: `pb-[calc(<base>+env(safe-area-inset-bottom))]` — e.g. `pb-[calc(16px+env(safe-area-inset-bottom))]`. Repo examples: `drawer.tsx`, `mobile_bottom_nav`, `size_guide_drawer`, cart/orders/gift-card sticky bars.
  3. **Apply it once per ancestor chain** — if a wrapper adds `pb-[env(safe-area-inset-bottom)]` and its child also adds `pb-[calc(32px+env(safe-area-inset-bottom))]`, the inset double-stacks and over-pads the bar. Only one element in the stack applies it.
