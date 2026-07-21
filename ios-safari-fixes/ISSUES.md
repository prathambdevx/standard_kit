# IOS issues:

Running log of iOS-Safari-only bugs hit in real projects and how they were fixed. Add a bullet each time a new one surfaces. (Deeper explanations of the recurring ones live in `SKILL.md`.)

- **Footer FAQ accordion — the whole lower page jerks up/down on open/close (iOS).** Filed as "payment options flicker," but the recording shows the footer's bottom bar (payment icons + copyright) *jumping vertically* and ducking behind the fixed bottom nav — a layout/scroll jerk, not the SVGs shimmering in place. **Likely cause (still to confirm on a real iPhone):** the accordion animates CSS `height` over ~0.25s; with the page scrolled to the bottom, each frame changes the document height, so the browser re-clamps scroll position frame-by-frame → jerky vertical slide (iOS does this clamp-during-animation badly). **Amplifier (confirmed in code):** those synthetic per-frame scroll deltas feed a `useHideOnScroll` hook that slides the fixed bottom nav in/out on any >4px delta, and the payment row sits right at the nav's edge. **Ruled out:** SVG repaint-layer flicker — `transform-gpu`/`backface-hidden` is a real but *different* iOS bug (see rule 7 in `SKILL.md`); it does nothing for a scroll/layout jerk. Fix TBD once reproduced on device — candidates: drop the height animation on the footer accordion, and/or stop non-user scroll deltas from toggling the bottom nav.

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
