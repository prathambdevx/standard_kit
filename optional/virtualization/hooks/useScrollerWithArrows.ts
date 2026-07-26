'use client';

import { useCallback, useEffect, useState } from 'react';

/** Tracks imperative scrollLeft/scrollRight and whether the scroller can still
 *  move in each direction, so arrows can disable at the ends. */
export const useScrollerWithArrows = <T extends HTMLElement>(step = 320, trackScroll = false) => {
  const [node, setNode] = useState<T | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  // Scroll-line thumb as fractions (0–1): `width` = visible/total, `scroll` = scrollLeft/maxScroll.
  const [progress, setProgress] = useState({ width: 1, scroll: 0 });

  const setRefs = useCallback((n: T | null) => {
    setNode(n);
  }, []);

  useEffect(() => {
    if (!node) return;

    // THE CACHE — the two layout-dependent reads, kept here instead of read per scroll event.
    // Reading either forces a synchronous layout of the whole track whenever style/layout work is
    // pending (mid-fling it always is: lazy images landing, img-fade transitions running).
    let clientWidth = node.clientWidth;
    let scrollWidth = node.scrollWidth;

    // HOT PATH — runs on every scroll event, measures nothing. Reads the cache above plus
    // scrollLeft, which is a scroll offset the browser already knows (not a layout read).
    // 1px slack absorbs sub-pixel rounding so an arrow doesn't stay enabled at a true edge
    const apply = () => {
      const { scrollLeft } = node;
      setCanScrollLeft(scrollLeft > 1);
      setCanScrollRight(Math.ceil(scrollLeft + clientWidth) < scrollWidth - 1);

      const width = scrollWidth > 0 ? Math.min(1, clientWidth / scrollWidth) : 1;
      const maxScroll = scrollWidth - clientWidth;
      // Only track the live scroll fraction when a consumer needs the moving thumb.
      // Otherwise `scroll` stays 0 and the equality bail-out below skips the
      // per-scroll-event re-render (which was reconciling the whole rail — jank on
      // iOS momentum flings where scroll fires dozens of times/sec).
      const scroll = trackScroll && maxScroll > 0 ? scrollLeft / maxScroll : 0;
      setProgress((prev) =>
        prev.width === width && prev.scroll === scroll ? prev : { width, scroll },
      );
    };

    // CACHE REFRESH — the only place the two values above are re-read.
    const remeasure = () => {
      clientWidth = node.clientWidth;
      scrollWidth = node.scrollWidth;
      apply();
    };

    remeasure();
    node.addEventListener('scroll', apply, { passive: true });
    // What keeps the cache honest: resize is the only thing that changes those two values.
    // The track is observed as well as the scroller because `node` has a fixed width — its own
    // box doesn't change when the cards inside it do, so node alone would never fire and the
    // cached scrollWidth would go stale (wrong right-arrow state).
    const observer = new ResizeObserver(remeasure);
    observer.observe(node);
    const track = node.firstElementChild;
    if (track) observer.observe(track);

    return () => {
      node.removeEventListener('scroll', apply);
      observer.disconnect();
    };
  }, [node, trackScroll]);

  // Advance exactly one card: measure the first card's width + the flex gap at
  // click time, so arrows stay correct even when card width is fluid (% based).
  // Falls back to the passed `step` when there's no measurable child.
  const cardStep = () => {
    const child = node?.firstElementChild as HTMLElement | null;
    if (!node || !child) return step;
    const gap = Number.parseFloat(getComputedStyle(node).columnGap) || 0;
    return child.offsetWidth + gap;
  };

  // Honor reduced-motion: jump instantly instead of animating the scroll.
  const behavior: ScrollBehavior =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth';

  return {
    node,
    setRefs,
    canScrollLeft,
    canScrollRight,
    progress,
    scrollLeft: () => node?.scrollBy({ left: -cardStep(), behavior }),
    scrollRight: () => node?.scrollBy({ left: cardStep(), behavior }),
  };
};
