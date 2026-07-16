'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * Scroll entrance: hidden until the element scrolls into view, then slides up
 * + fades in once with a pronounced rise (`animate-reveal-up-far`, sharing the
 * site's motion tokens + reduced-motion handling). Unlike <RevealUp> (which
 * fires on mount), this is gated by an IntersectionObserver — use it for
 * below-the-fold content that should clearly rise in as the user scrolls.
 *
 * `step` staggers the reveal by multiples of `--motion-delay-step`.
 */
export const RevealOnScroll = ({
  children,
  step = 0,
  className,
}: {
  children: ReactNode;
  step?: number;
  className?: string;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Reveal once, then stop observing — entrance shouldn't replay on scroll-back.
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      // Negative bottom margin delays the trigger — rows reveal once they're
      // ~20% up into the viewport rather than the moment they peek in.
      { rootMargin: '0px 0px -20% 0px', threshold: 0.1 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn(visible ? 'animate-reveal-up-far' : 'opacity-0', className)}
      style={
        visible && step > 0
          ? { animationDelay: `calc(var(--motion-delay-step) * ${step})` }
          : undefined
      }
    >
      {children}
    </div>
  );
};
