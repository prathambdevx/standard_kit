import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Entrance reveal: slide up + fade in, timed by the global motion
 * tokens. Animates on mount — pass a changing React `key` (e.g. the
 * active carousel slide) to replay it. `step` staggers siblings by
 * multiples of `--motion-delay-step`.
 *
 * `animate={false}` renders the children static (visible immediately).
 * Use it for above-the-fold first paint: text that starts at opacity 0
 * is excluded from LCP, and a full-viewport hero image is too — leaving
 * Lighthouse/CrUX with NO_LCP if the initial hero copy animates in.
 */
export const RevealUp = ({
  children,
  step = 0,
  animate = true,
  className,
}: {
  children: ReactNode;
  step?: number;
  animate?: boolean;
  className?: string;
}) => (
  <div
    className={cn(animate && 'animate-reveal-up', className)}
    // Dynamic per-instance stagger — cannot be expressed as a static class.
    style={
      animate && step > 0
        ? { animationDelay: `calc(var(--motion-delay-step) * ${step})` }
        : undefined
    }
  >
    {children}
  </div>
);
