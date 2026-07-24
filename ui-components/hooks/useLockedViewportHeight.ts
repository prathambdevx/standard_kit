'use client';

import { useEffect, useState } from 'react';

/** Snapshots the real visible viewport height when `active` flips true, instead of trusting
 *  `svh`/`dvh` alone. Mobile browsers collapse their address bar on scroll — a full-screen overlay
 *  opened at that moment has a taller real viewport than `svh` (toolbar-visible) accounts for,
 *  leaving a gap; recalculating live via `dvh` avoids the gap but jitters on iOS as the toolbar
 *  animates.
 *
 *  A single synchronous measurement isn't quite enough: opening an overlay also locks body scroll
 *  (`position: fixed`), which on iOS Safari commonly snaps the toolbar back to fully expanded a
 *  moment later — shrinking the real viewport after that first read and pushing a bottom-pinned
 *  footer below the fold. The overlay's own scroll lock means nothing else changes the viewport
 *  while it's open (short of a device rotation), so listening for `resize` here only ever settles
 *  that one late correction — it does not reintroduce `dvh`'s continuous per-scroll-frame jitter,
 *  since there's no live scrolling happening inside a locked overlay to keep re-firing it.
 *
 *  Returns null until first measured (server render / pre-mount) so callers can fall back to a
 *  `svh`/`dvh` CSS default via `var(--locked-vh, <fallback>)`. */
export const useLockedViewportHeight = (active: boolean) => {
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      setHeight(null);
      return;
    }
    const measure = () => setHeight(window.visualViewport?.height ?? window.innerHeight);
    measure();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', measure);
    window.addEventListener('resize', measure);
    return () => {
      vv?.removeEventListener('resize', measure);
      window.removeEventListener('resize', measure);
    };
  }, [active]);

  return height;
};
