'use client';

import { Img } from '@/components/ui/img';

type PreloadSize = { width: number; height: number };

/** Warms the CDN cache at the same width the Img loader would request for
 *  `renderWidth` (loader doubles for DPR, capped at 2560) — so this warm and the
 *  eventual <Img> fetch land on the identical URL and the real fetch is a cache hit.
 *  Call it on `onMouseEnter`/hover-intent for anything that's about to swap to a
 *  bigger version of an image already on the page (a thumbnail → lightbox, a card
 *  → its detail view, etc). */
export const warmImageCache = (src: string, renderWidth: number, quality = 75) => {
  const targetWidth = Math.min(Math.round(renderWidth * 2), 2560);
  const sep = src.includes('?') ? '&' : '?';
  const param = src.includes('cdn.shopify.com') ? 'width' : 'w';
  new window.Image().src = `${src}${sep}${param}=${targetWidth}&q=${quality}`;
};

/** Mounts an invisible <Img> for every item except `skipSrc`, at each size in
 *  `sizes` — same src/width/height the visible Img will use once that item is
 *  shown, so switching to it lands on an already-cached image instead of a fresh
 *  fetch. Pairs well with a swappable single-image view (a carousel driven by one
 *  "current" index, a lightbox, a color-swap hero) where only one image is ever
 *  actually mounted at a time. `items` only needs a `src` field — not tied to any
 *  particular domain shape. */
export const ImagePreload = ({
  items,
  skipSrc,
  sizes,
}: {
  items: { src: string }[];
  skipSrc?: string;
  sizes: PreloadSize[];
}) => (
  <>
    {items.map((item) =>
      item.src === skipSrc
        ? null
        : sizes.map(({ width, height }) => (
            <Img
              key={`${item.src}-${width}x${height}`}
              src={item.src}
              alt=""
              width={width}
              height={height}
              className="invisible absolute size-0"
              aria-hidden="true"
            />
          )),
    )}
  </>
);
