'use client';

import { forwardRef, type ReactNode, useEffect, useRef, useState } from 'react';

interface EdgeScrollProps {
  children: ReactNode;
  gap?: string;
  bleed?: boolean;
  className?: string;
  snap?: 'proximity' | 'mandatory';
  // Opt into the continuous fl-px-[16,24] bleed-cancel (globals.css). Only pass this
  // when the host section's OWN padding is fl-px-[16,24] — the default stays the
  // stepped 16px/24px pair that matches a plain `px-4 lg:px-6` host; mixing them
  // overflows the page (see globals.css [data-edge-scroll] comment).
  fluid?: boolean;
}

// SSR/pre-paint fallback only — the computed-style effect below takes over once
// mounted, the only way to resolve an fl-gap-[8,12] clamp. `gap-[X]` → X, `gap-N` →
// N*0.25rem; fl-gap-*/fluid-gap-* tokens don't start with `gap-` so they fall through.
const toLen = (token = ''): string => {
  const arbitrary = /gap-\[(.+)\]$/.exec(token);
  if (arbitrary?.[1]) return arbitrary[1].replace(/_/g, ' ');
  const scale = /gap-(\d+(?:\.\d+)?)$/.exec(token);
  return scale?.[1] ? `${+scale[1] * 0.25}rem` : '0.5rem';
};

export const EdgeScroll = forwardRef<HTMLDivElement, EdgeScrollProps>(
  (
    { children, gap = 'gap-2', bleed = true, className = '', snap = 'proximity', fluid = false },
    ref,
  ) => {
    const trackRef = useRef<HTMLDivElement>(null);
    const [liveGap, setLiveGap] = useState<string | null>(null);

    // Read the RENDERED gap instead of parsing the class string — the only way this
    // resolves fl-gap-[8,12] correctly (mirrors useScrollerWithArrows' computed-columnGap read).
    useEffect(() => {
      const node = trackRef.current;
      if (!node) return;
      const measure = () => {
        const live = getComputedStyle(node).columnGap;
        if (live && live !== 'normal') setLiveGap(live);
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
    }, []);

    // scroll-snap-type lives on the scroll container (the overflow element), never the inner track.
    const snapClass = `snap-x ${snap === 'mandatory' ? 'snap-mandatory' : 'snap-proximity'}`;
    const base = `no-scrollbar overflow-x-auto overflow-y-hidden ${snapClass} cursor-grab active:cursor-grabbing lg:cursor-auto select-none [&_img]:pointer-events-none ${className}`;

    if (!bleed) {
      return (
        <div ref={ref} data-edge-scroll className={base}>
          <div ref={trackRef} className={`flex ${gap}`}>
            {children}
          </div>
        </div>
      );
    }

    // Trailing spacer: width = page padding, margin-inline-start = −gap to cancel the flex gap before
    // it — the only reliable scrollable end-padding, since padding/margin on real children is dropped
    // from scrollWidth in overflow flex containers. Logical props (ps/ms) keep it RTL-correct.
    // --es-pad (globals.css) defaults to the stepped 16px/24px pair matching a plain px-4 lg:px-6
    // host; the `fluid` prop switches it to the continuous fl-px-16-24 curve via CSS cascade, so
    // the cancel stays aligned with a converted parent's padding at every width.
    const esGap = liveGap ?? toLen(gap.split(/\s+/).find((t) => /^gap-/.test(t)));
    const style = { '--es-gap': esGap } as React.CSSProperties;

    return (
      <div
        ref={ref}
        data-edge-scroll
        data-edge-scroll-fluid={fluid || undefined}
        style={style}
        className={`${base} mx-[calc(-1*var(--es-pad))] scroll-ps-[var(--es-pad)]`}
      >
        <div ref={trackRef} className={`flex ${gap} ps-[var(--es-pad)]`}>
          {children}
          <div aria-hidden className="shrink-0 w-[var(--es-pad)] ms-[calc(-1*var(--es-gap))]" />
        </div>
      </div>
    );
  },
);

EdgeScroll.displayName = 'EdgeScroll';
