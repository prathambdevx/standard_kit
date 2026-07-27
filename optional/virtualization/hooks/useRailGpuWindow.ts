'use client';

// Full explanation + how we found it: docs/research/scroll-jank-cpu-vs-gpu.md

import { type RefObject, useEffect, useRef, useState } from 'react';

/** Caps a horizontal rail at `windowSize` cards until it's scrolled, to keep its GPU layer
 *  small — unlike vertical scroll, iOS draws a horizontal scroller at its full width up front. */
export function useRailGpuWindow<T extends HTMLElement, C extends HTMLElement = HTMLElement>(
  scrollerNode: T | null,
  totalCards: number,
  windowSize: number,
): { containerRef: RefObject<C | null>; visibleCount: number } {
  const [expanded, setExpanded] = useState(false);
  const windowed = !expanded && totalCards > windowSize;
  const visibleCount = windowed ? windowSize : totalCards;

  // Two-way (not once-only) — the collapse below needs to know when the rail leaves view too.
  const containerRef = useRef<C>(null);
  const [railInView, setRailInView] = useState(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setRailInView(!!entry?.isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Expand on the rail's own scroll — covers touch, wheel and the arrow buttons.
  useEffect(() => {
    if (!scrollerNode || !windowed || !railInView) return;
    const expand = () => setExpanded(true);
    // Armed only while visible, so the collapse's own scrollTo below can't re-trigger it.
    scrollerNode.addEventListener('scroll', expand, { once: true, passive: true });
    return () => scrollerNode.removeEventListener('scroll', expand);
  }, [scrollerNode, windowed, railInView]);

  // A narrow rail or wide screen can fit all 6 windowed cards with nothing left to scroll — with
  // no scroll event, expand above never fires, so cards past the window would be stuck. Expand
  // right away if there's no overflow, measured straight off the DOM.
  useEffect(() => {
    if (!scrollerNode || !windowed || !railInView) return;
    const checkOverflow = () => {
      if (scrollerNode.scrollWidth <= scrollerNode.clientWidth + 1) setExpanded(true);
    };
    checkOverflow();
    const observer = new ResizeObserver(checkOverflow);
    observer.observe(scrollerNode);
    return () => observer.disconnect();
  }, [scrollerNode, windowed, railInView]);

  // Shrink back once off screen, rewinding scroll so re-entry starts at the same window.
  useEffect(() => {
    if (railInView || !expanded) return;
    setExpanded(false);
    scrollerNode?.scrollTo({ left: 0 });
  }, [railInView, expanded, scrollerNode]);

  return { containerRef, visibleCount };
}
