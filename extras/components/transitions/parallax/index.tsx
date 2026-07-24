'use client';

import type { ReactNode } from 'react';
import { useParallax } from '@/hooks/useParallax';
import { cn } from '@/lib/cn';

/**
 * Scroll-linked parallax layer. Place inside an `overflow-hidden` frame; the
 * layer is sized taller than the frame so it can drift without revealing a
 * gap. `speed` is the fraction of its height travelled across a viewport pass;
 * `overflow` is the % it extends past the frame each side (keep `speed`·layer
 * height ≤ `overflow`). Size the child image `h-auto w-full min-h-full
 * object-cover` — full frame width at natural height, so the crop stays
 * vertical (the drift axis); the layer centers the vertical excess.
 */
export const Parallax = ({
  children,
  speed = 0.15,
  overflow = 20,
  className,
}: {
  children: ReactNode;
  speed?: number;
  overflow?: number;
  className?: string;
}) => {
  const ref = useParallax<HTMLDivElement>(speed);

  return (
    <div
      ref={ref}
      className={cn('absolute inset-x-0 flex items-center will-change-transform', className)}
      style={{ top: `-${overflow}%`, bottom: `-${overflow}%` }}
    >
      {children}
    </div>
  );
};
