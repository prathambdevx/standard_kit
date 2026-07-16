import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Wraps an `Img`/`Picture` so it scales up slightly on hover. The scale must live on
 * this wrapper, never on the image itself — `Img`'s own fade-in transition uses the
 * shorthand `transition: opacity ...`, which resets `transition-property` and silently
 * swallows a `transform`/`scale` transition placed on that same element. The card's own
 * outer element still needs `group` (it usually already carries the aspect-ratio /
 * overflow-hidden / rounded-corner classes, which vary per call site).
 */
export const HoverZoomImage = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      'size-full transition-transform duration-300 group-hover:scale-[1.02]',
      className,
    )}
  >
    {children}
  </div>
);
