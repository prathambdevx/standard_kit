'use client';

import { useEffect } from 'react';

const COUNT_ATTR = 'data-scroll-lock-count';

/** Locks page scroll while active; the ref-count lives on the DOM element itself (not module
 *  state) so it survives hot-reload and stays correct across overlapping locks (e.g. a drawer
 *  handing off to another overlay) until the last one closes.
 *
 *  iOS Safari ignores `overflow: hidden` for touch-drag (and drags the page under the keyboard
 *  when a field is focused), so the body is pinned with `position: fixed` — the only reliable
 *  iOS lock — and the scroll position is restored on unlock. */
export const useBodyScrollLock = (active: boolean) => {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const body = document.body;
    const count = Number(root.getAttribute(COUNT_ATTR) ?? '0');
    if (count === 0) {
      const scrollY = window.scrollY;
      root.dataset.scrollLockY = String(scrollY);
      body.style.position = 'fixed';
      body.style.top = `-${scrollY}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.width = '100%';
      body.style.overflow = 'hidden';
    }
    root.setAttribute(COUNT_ATTR, String(count + 1));
    return () => {
      const remaining = Number(root.getAttribute(COUNT_ATTR) ?? '1') - 1;
      if (remaining <= 0) {
        const scrollY = Number(root.dataset.scrollLockY ?? '0');
        body.style.position = '';
        body.style.top = '';
        body.style.left = '';
        body.style.right = '';
        body.style.width = '';
        body.style.overflow = '';
        root.removeAttribute(COUNT_ATTR);
        delete root.dataset.scrollLockY;
        window.scrollTo(0, scrollY);
      } else {
        root.setAttribute(COUNT_ATTR, String(remaining));
      }
    };
  }, [active]);
};
