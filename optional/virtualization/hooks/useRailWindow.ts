'use client';

import { type RefObject, useEffect, useRef, useState } from 'react';

/**
 * GPU WINDOWING for a horizontal scroller — the drawing-side sibling of useVirtualization.
 *
 * Why it exists: iOS composites every touch-scrollable `overflow-x` region into its own layer,
 * and that layer's backing store is rasterised at its FULL scrollable width — content
 * irrelevant, `width × height × 4 bytes`. A 12-card product rail ≈ 15MB at 3× DPR, held
 * whether or not the user ever scrolls it. Stack a few rails near a hero and the page exceeds
 * what the phone's GPU can hold at one scroll position → tile eviction mid-fling → stutter
 * with an IDLE main thread. (Vertical content never has this problem: the document's own layer
 * is tiled and auto-evicted by distance. Horizontal scrollers get a private, untiled sheet.)
 *
 * Virtualization CANNOT fix this: placeholders keep the item boxes, the boxes keep the width,
 * and the width is the bill. The boxes themselves have to go — so this hook windows the
 * rendered ITEM COUNT:
 *
 *   1. Mount `windowSize` items (pick ~3 phone-screens of runway).
 *   2. Expand to the full list on the rail's OWN first scroll event — fires for touch, wheel
 *      and programmatic scrollBy (arrow buttons) alike, never for vertical page scrolling.
 *      Expansion happens at gesture start, so the rest exist long before the fling reaches
 *      the window's edge: no visible pop-in, and appending to the right can't shift content.
 *   3. Collapse back to the window when the rail leaves the viewport, rewinding scrollLeft
 *      to 0. Without this, a user who swipes every rail leaves every strip full-width and
 *      the memory win evaporates (observed on device). Collapsing off screen + rewinding
 *      means re-entry always shows the window's own items — no placeholder flash, ever.
 *
 * The trap this design dodges: collapsing a scrolled rail makes the browser clamp its scroll
 * position, and the rewind calls scrollTo(0) — BOTH fire the very scroll event that triggers
 * expansion (instant re-expand loop). Guard: the expand listener is only attached while the
 * rail is on screen; collapse only happens off screen, so its events land on no listener.
 *
 * Usage:
 *   const { containerRef, visibleCount } = useRailWindow(scrollerNode, products.length, 6);
 *   <section ref={containerRef}>
 *     <div ref={setScrollerNode} className="overflow-x-auto ...">
 *       {products.slice(0, visibleCount).map(...)}
 *     </div>
 *   </section>
 *
 * Keep analytics/impressions on the FULL list, not the rendered slice — what the user was
 * shown conceptually is all items; the slice is a rendering detail.
 */
export function useRailWindow<T extends HTMLElement, C extends HTMLElement = HTMLElement>(
  node: T | null,
  total: number,
  windowSize = 6,
): { containerRef: RefObject<C | null>; visibleCount: number } {
  const [expanded, setExpanded] = useState(false);
  const windowed = !expanded && total > windowSize;
  const visibleCount = windowed ? windowSize : total;

  // Two-way in-view on the rail's outer container (not the scroller — the scroller is what
  // we mutate, the container is what tells us the user can see it). The 300px margin gives
  // hysteresis so a rail hovering at the viewport edge doesn't thrash expand/collapse.
  const containerRef = useRef<C>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setInView(!!entry?.isIntersecting), {
      rootMargin: '300px',
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // EXPAND — armed only while on screen, so collapse's own scroll events can't re-trigger it.
  useEffect(() => {
    if (!node || !windowed || !inView) return;
    const expand = () => setExpanded(true);
    node.addEventListener('scroll', expand, { once: true, passive: true });
    return () => node.removeEventListener('scroll', expand);
  }, [node, windowed, inView]);

  // COLLAPSE — off screen only. Rewind so re-entry lands at the start, where the windowed
  // items are exactly the ones in view.
  useEffect(() => {
    if (inView || !expanded) return;
    setExpanded(false);
    node?.scrollTo({ left: 0 });
  }, [inView, expanded, node]);

  return { containerRef, visibleCount };
}
