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
 *  footer below the fold. So it re-measures on resize.
 *
 *  Measures `visualViewport.offsetTop + visualViewport.height` — the distance from the LAYOUT
 *  viewport's top to the bottom of the currently visible area. Both terms are load-bearing, and
 *  each came from a separate shipped bug:
 *
 *  - `height` MUST shrink when the on-screen keyboard opens. An overlay left at full height lays
 *    its scroll container out BEHIND the keyboard, so the container believes it has nothing to
 *    scroll, swallows the touch, and the content under the keyboard is unreachable. (Measuring
 *    `window.innerHeight` instead closes the gap below but causes exactly this.)
 *
 *  - `offsetTop` is the term that's easy to miss. A consumer of this value is anchored to the
 *    LAYOUT viewport's top, but iOS pans the VISUAL viewport down to reveal a focused input — so a
 *    box sized by `height` alone keeps its top at the layout top while its bottom edge rides up
 *    with the pan, exposing whatever sits behind it in the strip between that edge and the
 *    keyboard. Adding `offsetTop` grows the box by exactly the pan distance, pinning its bottom
 *    edge to the top of the keyboard instead.
 *
 *  With no keyboard, `offsetTop` is 0 and this reduces to the full viewport height — the toolbar
 *  collapse/expand case above. Listens for visualViewport `scroll` as well as `resize`, since a pan
 *  changes `offsetTop` without changing `height`.
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
