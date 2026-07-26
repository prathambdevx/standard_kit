'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * VIRTUALIZATION (1 of 3) — the detector. The only thing here that decides "near or far".
 *
 * The other two pieces live in the consumer (currently common/product_card/product_card_image.tsx):
 *   2 of 3 — the decision: `const isReal = priority || shouldRender`
 *   3 of 3 — the swap: an `isReal ? <real/> : <placeholder/>` ternary, which is what actually
 *            unmounts the expensive subtree and frees its memory.
 *
 * `shouldRender` is true while the returned ref's element is within `rootMargin` of the viewport
 * and false once it scrolls far enough away. It flips BOTH ways on purpose — that two-way toggle is
 * what makes this virtualization rather than a one-time "has it been seen yet" gate.
 *
 * Two rules for callers:
 *   - Put the ref on an element that stays mounted in BOTH branches. Putting it inside the
 *     conditional subtree loses the observer's target on unmount, and it never flips back.
 *   - Give the placeholder the same box (aspect ratio / height) as the real subtree, or the page
 *     height changes on every swap and the scroll position jumps.
 *
 * Use for per-instance cost the browser keeps paying while mounted regardless of visibility:
 * carousel engines, observers, drag/gesture listeners, decoded images. Note it is NOT needed to
 * avoid downloading offscreen images — native `loading="lazy"` already covers that.
 *
 * `rootMargin` is the pre-render buffer: bigger means the real subtree is ready earlier (fewer
 * placeholder flashes on a fast scroll) at the cost of keeping more instances alive at once;
 * smaller is cheaper but can be out-scrolled. 800px ≈ 2-3 rows of a mobile product grid.
 */
export function useVirtualization<T extends HTMLElement>(enabled = true, rootMargin = '800px') {
  const ref = useRef<T>(null);
  const [isIntersecting, setIsIntersecting] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsIntersecting(!!entry?.isIntersecting),
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, rootMargin]);

  // Disabled → always "render for real", and no observer is ever created. A caller with
  // nothing expensive to reclaim shouldn't pay for one, and — more importantly — must not
  // swap its subtree at all: an unmount/remount mid-scroll forces a re-decode and a paint,
  // which is a hitch you'd be *adding*. rootMargin applies to every edge, so this bites
  // hardest in a horizontally-scrolled rail, where items enter and leave sideways.
  //
  // Derived, not seeded into state: `enabled` can flip true → false on an already-mounted item
  // (a card's data changing to a single image), and the effect above bails before it could
  // restore anything — leaving the item stuck on its placeholder forever.
  return { ref, shouldRender: !enabled || isIntersecting };
}
