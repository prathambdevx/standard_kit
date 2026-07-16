'use client';
import type { ImageProps } from 'next/image';
import Image from 'next/image';
import type { FC, SyntheticEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { InfiniteLoader } from '@/assets/icons/infinite_loader';
import { cn } from '@/lib/cn';

type ImgProps = ImageProps & {
  showLoader?: boolean;
  isShopify?: boolean;
  'data-testid'?: string;
};

/**
 * Img — Next.js <Image> wrapper with CDN loader.
 *
 *   resolve loading/fetchPriority: explicit prop wins → priority-derived → defaults
 *     ↓
 *   imageLoader → ${src}?width=${target*1.5}&q=${quality}  (capped 2560, GIFs skipped)
 *     ↓
 *   if showLoader → IntersectionObserver delays render until in view
 *
 * Pass `priority` for above-fold; `showLoader` for spinner-gated galleries.
 */
export const Img: FC<ImgProps> = ({
  src,
  className = '',
  width = 100,
  height = 100,
  showLoader = false,
  isShopify = false,
  quality,
  alt = 'Image',
  priority,
  sizes,
  loading,
  fetchPriority,
  onLoad,
  onError,
  'data-testid': dataTestId,
  ...props
}) => {
  const resolvedLoading = loading ?? (priority ? 'eager' : 'lazy');
  const resolvedFetchPriority = fetchPriority ?? (priority ? 'high' : 'auto');
  const [isInView, setIsInView] = useState(!showLoader);
  const [isLoaded, setIsLoaded] = useState(false);
  // Track which src failed, not a bare boolean — a changed src then clears the failure during
  // render, so a new image always gets a fresh attempt (no reset effect needed).
  const [erroredSrc, setErroredSrc] = useState<ImageProps['src'] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // Fade only genuinely lazy images. Any above-fold signal — priority, or an
  // explicit eager/high hint — paints instantly so LCP isn't delayed; the
  // showLoader path has its own spinner gate. Resolved values already fold in
  // priority (it derives eager + high).
  const shouldFade = !showLoader && resolvedLoading !== 'eager' && resolvedFetchPriority !== 'high';
  const numericWidth =
    typeof width === 'number' ? width : Number.parseInt(String(width), 10) || 100;
  const numericHeight =
    typeof height === 'number' ? height : Number.parseInt(String(height), 10) || 100;
  const resolvedQuality = quality ?? (numericWidth <= 120 ? 60 : 75);
  const resolvedSizes = sizes ?? `(max-width: ${numericWidth}px) 100vw, ${numericWidth}px`;

  const isGif = typeof src === 'string' && src.includes('.gif');

  // Missing or failed src → a soft branded placeholder box, never the browser broken-image glyph.
  const errored = erroredSrc !== null && erroredSrc === src;
  const handleError = useCallback(
    (e: SyntheticEvent<HTMLImageElement>) => {
      setIsLoaded(true);
      setErroredSrc(src);
      onError?.(e);
    },
    [onError, src],
  );

  const imageLoader = useCallback(
    ({
      src: imageSrc,
      width: imageWidth,
      quality: imageQuality,
    }: {
      src: string;
      width: number;
      quality?: number;
    }) => {
      const dpr = 2;
      const maxWidth = Math.min(Math.round(numericWidth * dpr), 2560);
      const optimizedWidth = Math.min(imageWidth, maxWidth);
      const separator = imageSrc.includes('?') ? '&' : '?';

      if (isGif) {
        return imageSrc;
      } else if (isShopify || imageSrc.includes('cdn.shopify.com')) {
        return `${imageSrc}${separator}width=${optimizedWidth}&q=${imageQuality ?? resolvedQuality}`;
      } else {
        return `${imageSrc}${separator}w=${optimizedWidth}&q=${imageQuality ?? resolvedQuality}`;
      }
    },
    [numericWidth, isGif, isShopify, resolvedQuality],
  );

  useEffect(() => {
    if (!showLoader) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '50px', threshold: 0.01 },
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [showLoader]);

  // Cached images can finish before hydration, so onLoad never fires — flip to
  // loaded immediately if the element is already complete, else it stays hidden.
  useEffect(() => {
    if (shouldFade && imgRef.current?.complete) setIsLoaded(true);
  }, [shouldFade]);

  if (!src || errored) {
    return (
      <div
        role="img"
        aria-label={typeof alt === 'string' ? alt : undefined}
        data-testid={dataTestId}
        style={{ aspectRatio: `${numericWidth} / ${numericHeight}` }}
        className={cn('flex items-center justify-center', className)}
      >
        {/* BSC seal watermark — multiply keys the emblem's white bg out against the host surface */}
        {/* biome-ignore lint/performance/noImgElement: tiny local decorative asset, not content */}
        <img
          src="/images/bsc-emblem.png"
          alt=""
          aria-hidden="true"
          className="w-[38%] max-w-[88px] opacity-70 mix-blend-multiply"
        />
      </div>
    );
  }

  if (!showLoader) {
    return (
      <Image
        ref={imgRef}
        className={cn(
          'h-auto w-full object-cover',
          shouldFade && 'img-fade',
          shouldFade && (isLoaded ? 'opacity-100' : 'opacity-0'),
          className,
        )}
        loader={imageLoader}
        width={width}
        height={height}
        src={src}
        alt={alt}
        quality={resolvedQuality}
        sizes={resolvedSizes}
        unoptimized={isGif}
        priority={priority}
        loading={resolvedLoading}
        fetchPriority={resolvedFetchPriority}
        data-testid={dataTestId}
        onLoad={(e) => {
          if (shouldFade) setIsLoaded(true);
          onLoad?.(e);
        }}
        onError={handleError}
        {...props}
      />
    );
  }

  const showLoaderState = !isInView || !isLoaded;

  return (
    <div ref={containerRef} className="relative" data-testid={dataTestId}>
      {showLoaderState && (
        <div className="flex-center absolute inset-0 bg-black/10">
          <InfiniteLoader />
        </div>
      )}
      {isInView && (
        <Image
          className={cn('h-auto w-full object-cover', className)}
          loader={imageLoader}
          width={width}
          height={height}
          src={src}
          alt={alt}
          priority={priority}
          loading={resolvedLoading}
          fetchPriority={resolvedFetchPriority}
          quality={resolvedQuality}
          sizes={resolvedSizes}
          unoptimized={isGif}
          onLoad={(e) => {
            setIsLoaded(true);
            onLoad?.(e);
          }}
          onError={handleError}
          {...props}
        />
      )}
    </div>
  );
};
