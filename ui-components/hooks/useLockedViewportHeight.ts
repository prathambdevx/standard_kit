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
 *  Measures `visualViewport.offsetTop + visualViewport.height` — the distance from the LAYOUT
 *  viewport's top to the bottom of the currently visible area. Both terms matter:
 *
 *  `height` alone shrinks when the on-screen keyboard opens, which is REQUIRED: an overlay left at
 *  full height lays its scroll container out behind the keyboard, so the container thinks it has
 *  nothing to scroll, swallows the touch, and the content under the keyboard becomes unreachable.
 *
 *  `offsetTop` is what the earlier version missed. A consumer of this value is anchored to the
 *  layout viewport's top, but iOS pans the VISUAL viewport down to reveal a focused input — so a
 *  box sized by `height` alone keeps its top at the layout top while its bottom edge rides up with
 *  the pan, exposing whatever sits behind it in the strip between that edge and the keyboard.
 *  Adding `offsetTop` grows the box by exactly the pan distance, pinning its bottom edge to the top
 *  of the keyboard instead. With no keyboard, `offsetTop` is 0 and this reduces to the full
 *  viewport height — the toolbar collapse/expand case this hook originally existed for.
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
    const vv = window.visualViewport;
    const measure = () => setHeight(vv ? vv.offsetTop + vv.height : window.innerHeight);
    measure();
    // `scroll` (not just `resize`) — an iOS pan to reveal a focused input changes offsetTop
    // without changing height, and that pan is exactly the case the offsetTop term corrects.
    vv?.addEventListener('resize', measure);
    vv?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    return () => {
      vv?.removeEventListener('resize', measure);
      vv?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [active]);

  return height;
};
