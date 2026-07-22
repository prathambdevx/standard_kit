# IOS issues:

Running log of iOS-Safari-only bugs hit in real projects and how they were fixed. Add a bullet each time a new one surfaces. (Deeper explanations of the recurring ones live in `SKILL.md`.)

- **Footer FAQ accordion — two distinct bugs shared one bug report, needed two separate fixes.** Filed as one "payment options flicker" ticket; turned out to be two unrelated iOS-only symptoms in the same area, fixed independently by two different people:
  1. **Scroll/layout jerk** (the whole lower page jumps vertically on open/close). Confirmed cause: the accordion animates CSS `height` over ~0.25s; iOS re-clamps `window.scrollY` frame-by-frame as the document height changes mid-animation, producing a jerky slide (worse when scrolled near the bottom). Fix: hold scroll steady for the animation's duration with a RAF loop that re-issues `scrollTo` any frame where it's drifted from the pre-toggle position (see `stabilizeScrollForAccordion` in the footer component — cancel the previous loop on a rapid re-toggle, and use the options-object form of `scrollTo` so it doesn't reset `scrollX`).
  2. **Payment SVG repaint flicker** (the icons themselves visibly re-render/shimmer during the same reflow). Separate cause, separate fix: promote that row to its own GPU layer with `transform-gpu` so the browser composites it instead of re-rasterizing the SVGs every reflow frame (rule 7 below).
  Neither fix substitutes for the other — a page that only adds `transform-gpu` still jerks on scroll; a page that only stabilizes scroll can still show SVG shimmer. Apply both when a bottom bar with icons/images sits below an animating accordion.

- **Full-viewport elements resize/jump as the URL bar hides on scroll — use `svh`, not `dvh`/`vh`.** `100dvh` tracks the live viewport, which iOS continuously resizes as the URL bar collapses; anything sized in `dvh` grows/shrinks mid-scroll (fullscreen lightbox, hero pinned to one screen, "cap at viewport" modal). `svh` = smallest viewport height, stable through the whole URL-bar animation. Use `dvh` only when you actually want live tracking.
  ```
  ❌ max-h-[calc(100dvh-150px)]      style={{ maxHeight: 'calc(100dvh - 150px)' }}
  ✅ max-h-[calc(100svh-150px)]      style={{ maxHeight: 'calc(100svh - 150px)' }}
  ```

- **Bottom bars need `env(safe-area-inset-bottom)` — but the viewport must opt in, and apply it exactly once per chain.** Fixed/sticky bottom bars, sticky CTAs, drawers and bottom-sheet modals must clear the iPhone home indicator, or they sit under it.
  1. The inset only returns real values when the viewport opts into the notch. In Next set it once in the root `layout.tsx`:
     ```ts
     export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };
     ```
  2. Then pad the bar: `pb-[calc(<base>+env(safe-area-inset-bottom))]` — e.g. `pb-[calc(16px+env(safe-area-inset-bottom))]`. Repo examples: `drawer.tsx`, `mobile_bottom_nav`, `size_guide_drawer`, cart/orders/gift-card sticky bars.
  3. **Apply it once per ancestor chain** — if a wrapper adds `pb-[env(safe-area-inset-bottom)]` and its child also adds `pb-[calc(32px+env(safe-area-inset-bottom))]`, the inset double-stacks and over-pads the bar. Only one element in the stack applies it.
