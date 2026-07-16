'use client';

import { useEffect } from 'react';
import { initScrollRestoration } from '@/lib/scroll_restoration';

/**
 * Saves per-URL scroll position as the user scrolls and restores it on browser
 * back/forward. All listeners live module-side (see `scroll_restoration.ts`) so
 * they survive the shell remounting on a suspended page — this just kicks the
 * one-time setup off on the client.
 */
export function ScrollRestoration() {
  useEffect(() => {
    initScrollRestoration();
  }, []);

  return null;
}
