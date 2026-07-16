'use client';
import type { EmblaCarouselType, EmblaOptionsType } from 'embla-carousel';
import Autoplay from 'embla-carousel-autoplay';
import useEmblaCarousel from 'embla-carousel-react';
import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

// --- Context Setup --- //
type CarouselContextType = {
  embla: EmblaCarouselType | undefined;
  selectedIndex: number;
  scrollTo: (index: number) => void;
  scrollNext: () => void;
  scrollPrev: () => void;
  slidesCount: number;
  canScrollNext: boolean;
  canScrollPrev: boolean;
  /** False until the first slide change (drag, autoplay or API). Overlay
      content uses this to skip entrance animations on initial paint —
      text that first paints at opacity 0 is excluded from LCP. */
  hasChanged: boolean;
};

const CarouselContext = createContext<CarouselContextType | null>(null);

export const useCarousel = () => {
  const ctx = useContext(CarouselContext);
  if (!ctx) throw new Error('Carousel components must be used within <Carousel>');
  return ctx;
};

// --- Root Carousel --- //
type CarouselProps = {
  children: React.ReactNode;
  autoplay?: boolean;
  interval?: number;
  loop?: boolean;
  initialIndex?: number;
  className?: string;
  /** Extra classes on the embla viewport (the overflow-hidden clip box) —
      e.g. padding so slides align inset while bleeding to the box edge. */
  viewportClassName?: string;
  /** Accessible name for the carousel region (defaults to "carousel"). */
  ariaLabel?: string;
  setApi?: (api: EmblaCarouselType | undefined) => void;
  opts?: EmblaOptionsType;
};

export const Carousel = ({
  children,
  autoplay = true,
  interval = 4000,
  loop = false,
  initialIndex = 0,
  className = '',
  viewportClassName,
  ariaLabel = 'carousel',
  setApi,
  opts,
}: CarouselProps) => {
  const autoplayPlugin = Autoplay({
    delay: interval,
    stopOnMouseEnter: true,
    stopOnInteraction: false,
    // Held until the page loads (started in the effect below) — an
    // auto-cycling carousel that re-reveals its largest text mid-load
    // registers a late LCP candidate and resets the LCP clock.
    playOnInit: false,
  });

  const [emblaRef, emblaApi] = useEmblaCarousel(
    { loop, startIndex: initialIndex, align: 'start', ...opts },
    autoplay ? [autoplayPlugin] : [],
  );

  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [slidesCount, setSlidesCount] = useState(0);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);
  const [hasChanged, setHasChanged] = useState(false);

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);
  const scrollTo = useCallback((index: number) => emblaApi?.scrollTo(index), [emblaApi]);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    setSlidesCount(emblaApi.slideNodes().length);
    emblaApi.on('select', onSelect);
    emblaApi.on('reInit', onSelect);
    // embla emits 'select' only on actual snap changes (not on init),
    // so this flips exactly at the first slide change.
    const markChanged = () => setHasChanged(true);
    emblaApi.on('select', markChanged);

    // Expose API to parent
    if (setApi) setApi(emblaApi);
  }, [emblaApi, onSelect, setApi]);

  // Defer the first auto-advance until after load — cycling mid-load
  // re-reveals the hero's largest text (opacity 0 → 1) and that late
  // paint becomes the LCP. Started here instead of playOnInit.
  useEffect(() => {
    if (!emblaApi || !autoplay) return;
    const plugin = emblaApi.plugins()?.autoplay;
    if (!plugin) return;
    const start = () => plugin.play();
    if (document.readyState === 'complete') {
      start();
      return;
    }
    window.addEventListener('load', start, { once: true });
    return () => window.removeEventListener('load', start);
  }, [emblaApi, autoplay]);

  return (
    <CarouselContext.Provider
      value={{
        embla: emblaApi,
        selectedIndex,
        scrollNext,
        scrollPrev,
        scrollTo,
        slidesCount,
        canScrollNext,
        canScrollPrev,
        hasChanged,
      }}
    >
      <section
        className={cn('relative w-full', className)}
        aria-roledescription="carousel"
        aria-label={ariaLabel}
      >
        <div className={cn('overflow-hidden', viewportClassName)} ref={emblaRef}>
          {children}
        </div>
      </section>
    </CarouselContext.Provider>
  );
};

// --- CarouselContent --- //
export const CarouselContent = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    // data attr lets descendants (e.g. ProductCard's swipe guard) detect
    // that an embla track moved during their gesture.
    <div
      data-carousel-content
      className={cn('flex touch-pan-y items-start select-none', className)}
    >
      {children}
    </div>
  );
};

// --- CarouselItem --- //
export const CarouselItem = ({
  children,
  className = '',
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) => {
  return (
    <div className={cn('min-w-0 shrink-0 grow-0 basis-full', className)} style={style}>
      {children}
    </div>
  );
};

// --- CarouselDots --- //
export const CarouselDots = ({ className = '' }: { className?: string }) => {
  const { slidesCount, selectedIndex, scrollTo } = useCarousel();
  if (slidesCount <= 1) return null;
  return (
    <div className={cn('flex gap-2', className)}>
      {Array.from({ length: slidesCount }).map((_, i) => (
        <Button
          key={i}
          aria-label={`Go to slide ${i + 1}`}
          onClick={() => scrollTo(i)}
          className={cn(
            'h-1.5 w-1.5 rounded-full transition-all',
            i === selectedIndex ? 'bg-text-primary' : 'bg-border-dark',
          )}
        />
      ))}
    </div>
  );
};
