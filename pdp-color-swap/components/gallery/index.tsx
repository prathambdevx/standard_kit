'use client';

import { useState } from 'react';

import type { GalleryData, GalleryImage } from '@/types/components/pdp/gallery';

import { DesktopGrid } from './desktop_grid';
import { Lightbox, type LightboxState } from './lightbox';
import { MobileCarousel } from './mobile_carousel';

export const Gallery = ({
  data,
  productName,
  swapKey,
}: {
  data: GalleryData;
  productName: string;
  swapKey?: string;
}) => {
  const { images, singleColumnDesktop, badge } = data;
  const [activeImage, setActiveImage] = useState<LightboxState | null>(null);

  const openLightbox = (img: GalleryImage, index: number) => {
    setActiveImage({ src: img.src, alt: img.alt, index });
  };

  if (!images.length) return null;

  return (
    <div className="relative">
      <MobileCarousel images={images} swapKey={swapKey} badge={badge} onOpen={openLightbox} />
      <DesktopGrid
        images={images}
        onOpen={openLightbox}
        singleColumn={singleColumnDesktop}
        badge={badge}
      />
      {activeImage && (
        <Lightbox
          images={images}
          activeImage={activeImage}
          productName={productName}
          onClose={() => setActiveImage(null)}
          onNavigate={openLightbox}
        />
      )}
    </div>
  );
};
