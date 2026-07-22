'use client';

import { Button } from '@/components/ui/button';
import { Img } from '@/components/ui/img';
import type { GalleryBadge, GalleryImage } from '@/types/components/pdp/gallery';
import { GalleryBadgeChip } from './gallery_badge';

// Warm the CDN cache for a grid image's lightbox-size version on hover so
// clicking opens instantly instead of waiting for a fresh fetch.
const preloadLightbox = (src: string) => {
  const sep = src.includes('?') ? '&' : '?';
  const url = src.includes('cdn.shopify.com')
    ? `${src}${sep}width=1800&q=75`
    : `${src}${sep}w=1800&q=75`;
  new window.Image().src = url;
};

export const DesktopGrid = ({
  images,
  onOpen,
  singleColumn,
  badge,
}: {
  images: GalleryImage[];
  onOpen: (img: GalleryImage, index: number) => void;
  singleColumn?: boolean;
  badge?: GalleryBadge;
}) => {
  // 1-2 image products: single full-width column, images fill the gallery area (696×864 aspect)
  if (singleColumn) {
    return (
      <div className="hidden flex-col fl-gap-[8,8] lg:flex">
        {images.map((img, i) => (
          <Button
            key={img.src}
            className="relative aspect-[696/864] w-full cursor-zoom-in overflow-hidden bg-surface-muted"
            onMouseEnter={() => preloadLightbox(img.src)}
            onClick={() => onOpen(img, i)}
          >
            {badge && i === 0 && <GalleryBadgeChip badge={badge} />}
            <Img
              src={img.src}
              alt={img.alt}
              width={696}
              height={864}
              priority={i === 0}
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="h-full w-full object-cover"
            />
          </Button>
        ))}
      </div>
    );
  }

  const leftCol = images.filter((_, i) => i % 2 === 0);
  const rightCol = images.filter((_, i) => i % 2 === 1);

  return (
    <div className="hidden fl-gap-[4,4] lg:flex">
      {/* Left column — even-indexed images */}
      <div className="flex flex-1 flex-col fl-gap-[4,4]">
        {leftCol.map((img, i) => (
          <Button
            key={img.src}
            className="relative aspect-[446/556] cursor-zoom-in overflow-hidden bg-surface-muted"
            onMouseEnter={() => preloadLightbox(img.src)}
            onClick={() => onOpen(img, i * 2)}
          >
            {badge && i === 0 && <GalleryBadgeChip badge={badge} />}
            <Img
              src={img.src}
              alt={img.alt}
              width={446}
              height={556}
              priority={i === 0}
              sizes="446px"
              className="h-full w-full object-cover"
            />
          </Button>
        ))}
      </div>

      {/* Right column — odd-indexed images */}
      {rightCol.length > 0 && (
        <div className="flex flex-1 flex-col fl-gap-[4,4]">
          {rightCol.map((img, i) => (
            <Button
              key={img.src}
              className="aspect-[446/556] cursor-zoom-in overflow-hidden bg-surface-muted"
              onMouseEnter={() => preloadLightbox(img.src)}
              onClick={() => onOpen(img, i * 2 + 1)}
            >
              <Img
                src={img.src}
                alt={img.alt}
                width={446}
                height={556}
                sizes="446px"
                className="h-full w-full object-cover"
              />
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};
