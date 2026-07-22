'use client';

import { Button } from '@/components/ui/button';
import { Carousel, CarouselContent, CarouselItem, useCarousel } from '@/components/ui/carousel';
import { Img } from '@/components/ui/img';
import type { GalleryBadge, GalleryImage } from '@/types/components/pdp/gallery';
import { GalleryBadgeChip } from './gallery_badge';

type OnOpen = (img: GalleryImage, index: number) => void;

const Dots = ({ count }: { count: number }) => {
  const { selectedIndex, scrollTo } = useCarousel();
  return (
    <div className="absolute fl-m-bottom-[16] fl-m-right-[16] flex items-center fl-m-gap-[4]">
      {Array.from({ length: count }, (_, i) => (
        <Button
          // biome-ignore lint/suspicious/noArrayIndexKey: dot order is stable
          key={i}
          variant="none"
          aria-label={`Go to image ${i + 1}`}
          aria-current={i === selectedIndex}
          onClick={() => scrollTo(i)}
          className={`fl-m-size-[6] rounded-full backdrop-blur-[10px] transition-colors ${
            i === selectedIndex ? 'bg-white' : 'bg-[rgba(173,173,173,0.4)]'
          }`}
        />
      ))}
    </div>
  );
};

export const MobileCarousel = ({
  images,
  swapKey,
  badge,
  onOpen,
}: {
  images: GalleryImage[];
  swapKey?: string;
  badge?: GalleryBadge;
  onOpen?: OnOpen;
}) => {
  return (
    <div className="lg:hidden">
      {/* key (the product handle) forces Embla to remount on each colour swap — React
          batches unmount+mount into one commit so there is no blank frame. Before Embla
          initialises, slides sit in natural CSS flow (left-to-right through overflow:hidden)
          showing slide 0, which is exactly the state the View Transition "after" screenshot
          needs to capture. */}
      <Carousel key={swapKey} autoplay={false} loop ariaLabel="Product gallery">
        <CarouselContent>
          {images.map((img, i) => (
            <CarouselItem key={img.src}>
              <Button
                variant="none"
                aria-label={`View ${img.alt} fullscreen`}
                onClick={() => onOpen?.(img, i)}
                className="relative aspect-[9/11] w-full overflow-hidden bg-surface-muted"
              >
                {badge && i === 0 && <GalleryBadgeChip badge={badge} />}
                <Img
                  src={img.src}
                  alt={img.alt}
                  width={720}
                  height={880}
                  priority={i === 0}
                  sizes="100vw"
                  className="size-full object-cover"
                />
              </Button>
            </CarouselItem>
          ))}
        </CarouselContent>
        <Dots count={images.length} />
      </Carousel>
    </div>
  );
};
