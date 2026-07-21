# IOS issues:

Running log of iOS-Safari-only bugs hit in real projects and how they were fixed. Add a bullet each time a new one surfaces. (Deeper explanations of the recurring ones live in `SKILL.md`.)

- **Payment icons / SVGs flicker while an accordion opens or closes.** The footer FAQ accordion animates CSS `height` (0→content-height). `height` isn't GPU-composited, so every frame forces a re-layout + repaint of everything below it — the row of payment SVGs sitting right under the accordion. iOS repaints those SVGs on a non-composited layer each frame and they flicker (fine on Chrome/Firefox). **Fix:** pin the flickering row to its own compositing layer so iOS paints it once and just translates it — `transform-gpu backface-hidden` (→ `transform: translateZ(0)` + `backface-visibility: hidden`) on the SVG row's container. Same fix applies to any static element that sits next to a height/`max-height`/layout-animating sibling.

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
