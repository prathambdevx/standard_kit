'use client';

import { useEffect, useState } from 'react';

/** Snapshots the real visible viewport height once when `active` flips true, instead of trusting
 *  `svh`/`dvh` alone. Mobile browsers collapse their address bar on scroll — a full-screen overlay
 *  opened at that moment has a taller real viewport than `svh` (toolbar-visible) accounts for,
 *  leaving a gap; recalculating live via `dvh` avoids the gap but jitters on iOS as the toolbar
 *  animates. Freezing `window.innerHeight` at open time gets the correct height either way, with
 *  no live recalculation to jitter. Returns null until measured (server render / pre-mount) so
 *  callers can fall back to a `svh`/`dvh` CSS default via `var(--locked-vh, <fallback>)`. */
export const useLockedViewportHeight = (active: boolean) => {
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      setHeight(null);
      return;
    }
    setHeight(window.visualViewport?.height ?? window.innerHeight);
  }, [active]);

  return height;
};
