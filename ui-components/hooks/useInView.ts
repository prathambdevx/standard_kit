'use client';

import { type RefObject, useEffect, useRef, useState } from 'react';

interface Options {
  // Start loading before the element is fully on screen (prefetch margin).
  rootMargin?: string;
  // Once true, stay true — we only need to trigger a lazy load once.
  once?: boolean;
}

/** Observe an element's viewport intersection. Returns a ref + whether it's in view. */
export function useInView<T extends HTMLElement = HTMLDivElement>({
  rootMargin = '300px',
  once = true,
}: Options = {}): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // SSR / unsupported → treat as visible so content still loads.
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            if (once) observer.disconnect();
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin, once]);

  return [ref, inView];
}
