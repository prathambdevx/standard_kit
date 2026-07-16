import { type RefObject, useEffect, useRef } from 'react';

/**
 * Scroll-linked vertical parallax. Translates the referenced element as its
 * container passes through the viewport — the layer must overflow its
 * `overflow-hidden` container (taller than the frame) so no gap is revealed.
 * `speed` is the fraction of the element's height it travels across a full
 * viewport pass. Honours `prefers-reduced-motion` (renders static).
 */
export const useParallax = <T extends HTMLElement>(speed = 0.1): RefObject<T | null> => {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Respect the OS reduced-motion preference — leave the element untransformed
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduce.matches) return;

    let frame = 0;

    const update = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // Skip work while the element is fully off-screen
      if (rect.bottom < 0 || rect.top > vh) return;

      // Progress through the viewport: +1 entering at the bottom, -1 leaving at the top
      const center = rect.top + rect.height / 2;
      const progress = (center - vh / 2) / (vh / 2 + rect.height / 2);
      const travel = rect.height * speed;
      el.style.transform = `translate3d(0, ${(progress * travel).toFixed(2)}px, 0)`;
    };

    // Coalesce scroll/resize bursts into one transform write per frame
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [speed]);

  return ref;
};
