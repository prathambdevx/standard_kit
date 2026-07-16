'use client';

import Lenis from 'lenis';
import { useEffect } from 'react';

/**
 * Mounts Lenis momentum smooth-scrolling for the lifetime of the page that
 * renders it (scoped, not global). Skipped under `prefers-reduced-motion`.
 */
export const SmoothScroll = () => {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const lenis = new Lenis({ duration: 1.1, smoothWheel: true });

    let frame = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);

  return null;
};
