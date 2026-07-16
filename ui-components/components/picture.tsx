'use client';

import type { ImageProps } from 'next/image';
import { preload } from 'react-dom';

import { Img } from '@/components/ui/img';
import { cn } from '@/lib/cn';

/** Tailwind v4 default screens — px at which each breakpoint starts. */
const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

export type PictureBreakpoint = keyof typeof BREAKPOINTS;

type ResponsiveImageProps = {
  mobileSrc: string;
  desktopSrc: string;
  alt: string;
  mobileWidth: number;
  desktopWidth: number;
  mobileHeight: number;
  desktopHeight: number;
  className?: string;
  showLoader?: boolean;
  priority?: boolean;
  href?: string;
  quality?: number;
  sizes?: string;
  /** Tailwind breakpoint at which the desktop source takes over (default `"lg"` = 1024px). */
  breakpoint?: PictureBreakpoint;
  /** Use `"low"` for below-fold lazy lists; `priority` overrides to `"high"` automatically. */
  fetchPriority?: 'high' | 'low' | 'auto';
} & Omit<ImageProps, 'src' | 'alt' | 'width' | 'height' | 'fetchPriority'>;

const DEFAULT_IMAGE_QUALITY = 75;

const clampWidth = (value: number) => Math.max(64, Math.min(Math.round(value), 2560));

const generateCandidateWidths = (targetWidth: number) =>
  Array.from(
    new Set([
      clampWidth(targetWidth * 0.66),
      clampWidth(targetWidth),
      clampWidth(targetWidth * 1.5),
      clampWidth(targetWidth * 2),
    ]),
  ).sort((a, b) => a - b);

const buildOptimizedSrc = (src: string, width: number, quality: number) => {
  if (!src) return '';
  const separator = src.includes('?') ? '&' : '?';
  const widthParam = src.includes('cdn.shopify.com') ? 'width' : 'w';
  return `${src}${separator}${widthParam}=${width}&q=${quality}`;
};

function generateSrcSet(
  src: string,
  targetWidth: number,
  quality: number = DEFAULT_IMAGE_QUALITY,
): string {
  const isGif = typeof src === 'string' && src.includes('.gif');

  if (isGif) {
    return src;
  }

  const widths = generateCandidateWidths(targetWidth);

  return widths.map((w) => `${buildOptimizedSrc(src, w, quality)} ${w}w`).join(', ');
}

/**
 * Picture — responsive art-directed image, LCP-optimized.
 *
 * Why preload (the timing trick):
 *   1. HTML arrives → browser scans <head>, sees our <link rel="preload">
 *      and starts downloading the device-matched image IMMEDIATELY
 *      (before CSS even loads, before the body is parsed).
 *   2. CSS parses → browser reaches <picture> in the body and evaluates
 *      <source media="..."> to pick mobile vs desktop srcSet.
 *   3. The chosen image is already in the cache → instant paint = better LCP.
 *
 * Without preload, step 1 doesn't happen — the image download only starts
 * AFTER CSS parses and <source> media queries resolve. That delay is the
 * LCP cost we're avoiding.
 *
 * Flow:
 *   mobileSrc + desktopSrc → generateSrcSet expands each into width variants
 *     ↓
 *   if priority → preload(<head>): one <link> per device, bundling
 *                 { imageSrcSet, imageSizes, media, fetchPriority:"high" }
 *     ↓
 *   render <picture>: <source> tags reuse the same srcSets; <Img> is fallback
 *
 * Pass `priority` for above-fold heroes — everything else is automatic.
 */
export const Picture = ({
  mobileSrc,
  desktopSrc,
  alt,
  mobileWidth,
  desktopWidth,
  mobileHeight: _mobileHeight,
  desktopHeight,
  className,
  priority,
  quality = DEFAULT_IMAGE_QUALITY,
  sizes,
  breakpoint = 'lg',
  fetchPriority,
  ...props
}: ResponsiveImageProps) => {
  const desktopSrcSet = generateSrcSet(desktopSrc, desktopWidth, quality);
  const mobileSrcSet = generateSrcSet(mobileSrc, mobileWidth, quality);

  // Preload media MUST match the <source> media below — a mismatch makes
  // priority heroes preload the wrong image, so both derive from `breakpoint`.
  const breakpointPx = BREAKPOINTS[breakpoint];
  const desktopMedia = `(min-width: ${breakpointPx}px)`;
  const mobileMedia = `(max-width: ${breakpointPx - 1}px)`;

  // In-between band (switch point → 1024px) uses 100vw since Picture is used for
  // full-bleed heroes/banners. Desktop uses the declared desktopWidth, mobile the mobileWidth.
  const resolvedSizes =
    sizes ??
    `(min-width: ${Math.max(breakpointPx, 1024)}px) ${desktopWidth}px, (min-width: ${breakpointPx}px) 100vw, ${mobileWidth}px`;

  if (priority) {
    preload(mobileSrc, {
      as: 'image',
      imageSrcSet: mobileSrcSet,
      imageSizes: resolvedSizes,
      fetchPriority: 'high',
      media: mobileMedia,
    });
    if (desktopSrc !== mobileSrc) {
      preload(desktopSrc, {
        as: 'image',
        imageSrcSet: desktopSrcSet,
        imageSizes: resolvedSizes,
        fetchPriority: 'high',
        media: desktopMedia,
      });
    }
  }

  const resolvedFetchPriority = priority ? 'high' : (fetchPriority ?? 'auto');
  const resolvedLoading = priority ? 'eager' : 'lazy';

  return (
    // `contents` removes <picture>'s own box — the <img> participates in
    // the parent's layout directly, so fill patterns (absolute wrapper +
    // h-full img) behave exactly like a bare <Img>.
    <picture className="contents">
      <source media={desktopMedia} srcSet={desktopSrcSet} sizes={resolvedSizes} />
      <source media={mobileMedia} srcSet={mobileSrcSet} sizes={resolvedSizes} />

      <Img
        alt={alt || 'Image'}
        src={desktopSrc}
        className={cn('h-auto w-full', className)}
        width={desktopWidth}
        height={desktopHeight}
        quality={quality}
        sizes={resolvedSizes}
        loading={resolvedLoading}
        fetchPriority={resolvedFetchPriority}
        {...props}
      />
    </picture>
  );
};
