'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Props = {
  /** Applied to the inner scrollable div — padding, min-height, etc. */
  className?: string;
  /** Applied to the outer flex-row wrapper — position, background, etc. */
  outerClassName?: string;
  /** Forwarded to the inner scroll node so callers can drive it (e.g. scroll-to-top on step change). */
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  /** Forwarded scroll handler (e.g. to lift a pinned header once content scrolls beneath it). */
  onScroll?: React.UIEventHandler<HTMLDivElement>;
  /** Show the custom thumb only below `lg`; desktop keeps its native scrollbar. */
  mobileOnly?: boolean;
  children: React.ReactNode;
};

/**
 * Replaces the native scrollbar with a persistent custom thumb on the right edge.
 * Scroll position updates the thumb directly via DOM mutation — no re-renders on scroll.
 */
export const ScrollArea = ({
  className,
  outerClassName,
  scrollRef,
  onScroll,
  mobileOnly = false,
  children,
}: Props) => {
  const innerRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const [isScrollable, setIsScrollable] = useState(false);

  // Merge the internal ref with an optional forwarded one so callers can drive the node.
  const setNode = useCallback(
    (n: HTMLDivElement | null) => {
      innerRef.current = n;
      if (scrollRef) scrollRef.current = n;
    },
    [scrollRef],
  );

  useEffect(() => {
    const node = innerRef.current;
    if (!node) return;

    const update = () => {
      const { scrollTop, clientHeight, scrollHeight } = node;
      const height = scrollHeight > 0 ? Math.min(1, clientHeight / scrollHeight) : 1;
      setIsScrollable(height < 1);

      // Direct DOM mutation keeps scroll tracking off React's render cycle
      if (thumbRef.current) {
        const maxScroll = scrollHeight - clientHeight;
        const scroll = maxScroll > 0 ? scrollTop / maxScroll : 0;
        thumbRef.current.style.height = `${height * 100}%`;
        thumbRef.current.style.top = `${scroll * (1 - height) * 100}%`;
      }
    };

    update();
    node.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      node.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, []);

  return (
    <div className={`flex flex-row ${outerClassName ?? ''}`}>
      <div
        ref={setNode}
        onScroll={onScroll}
        className={`flex-1 overflow-y-auto overscroll-contain min-w-0 ${mobileOnly ? 'max-lg:scrollbar-hide' : 'scrollbar-hide'} ${className ?? ''}`}
      >
        {children}
      </div>

      {/* Persistent thumb — dim/60, 6px, fully rounded (Figma spec); hidden when not scrollable */}
      <div
        className={`relative w-1.5 shrink-0 my-4 ${mobileOnly ? 'lg:hidden ' : ''}${isScrollable ? '' : 'invisible'}`}
      >
        <div ref={thumbRef} className="absolute inset-x-0 rounded-full bg-dim/60" />
      </div>
    </div>
  );
};
