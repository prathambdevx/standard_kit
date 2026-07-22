'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { PlusIcon } from '@/assets/icons/plus_icon';
import { Alink } from '@/components/ui/alink';
import { Button } from '@/components/ui/button';
import { Img } from '@/components/ui/img';
import { useSizeDrawer } from '@/lib/drawers';
import { startStateTransition } from '@/lib/view_transition';
import type { PairItem, PairProductHeroData } from '@/types/components/pdp/pair_product_hero';
import type { ProductCardData } from '@/types/components/pdp/product_card';
import { useColorSwapContext } from '../../hooks/useColorSwap';
import { toPairProductHeroData } from '../../mappers';
import { Accordions } from '../accordions';
import { ColorSwatchGrid } from '../color_swatch_grid';

// Matches the card width these items render at (see the Img below) — lets the
// "Added to Bag" toast reuse this exact CDN size instead of fetching a new variant.
const ITEM_IMAGE_SIZE = { width: 228, height: 239 };

export const PairProductHero = ({ data: initialData }: { data: PairProductHeroData }) => {
  const pathname = usePathname();
  const currentHandle = pathname.split('/').pop() ?? '';
  const [current, setCurrent] = useState(0);
  const startX = useRef(0);
  const openSizeDrawer = useSizeDrawer((s) => s.open);

  const swap = useColorSwapContext();
  const swappedData = swap?.product ? toPairProductHeroData(swap.product) : null;
  // Use swap data for gallery/accordions but lock colors+items order to initialData
  // — the swapped product may return these in a different order (selected first)
  const data = swappedData
    ? {
        ...swappedData,
        colors: initialData.colors,
        items: initialData.items.map((orig, i) => swappedData.items[i] ?? orig),
      }
    : initialData;

  const { gallery } = data;

  // biome-ignore lint/correctness/useExhaustiveDependencies: setCurrent is a stable useState setter
  useEffect(() => {
    setCurrent(0);
  }, [swap?.product.handle]);

  // Opens the shared size drawer instead of adding the default variant directly — matches
  // every other product card, letting the customer pick a real size before the item is added.
  const handleAddToBag = (item: PairItem) => {
    const cardData: ProductCardData = {
      id: item.productId,
      handle: item.handle,
      title: item.name,
      price: item.price,
      imageUrl: item.image,
      variantId: item.variantId,
    };
    openSizeDrawer(cardData, ITEM_IMAGE_SIZE);
  };

  const prev = () =>
    startStateTransition(() =>
      setCurrent((c) => (c - 1 + gallery.images.length) % gallery.images.length),
    );
  const next = () => startStateTransition(() => setCurrent((c) => (c + 1) % gallery.images.length));

  return (
    <section className="flex flex-col lg:flex-row lg:items-start lg:fl-d-gap-[64] lg:fl-d-pb-[48] lg:fl-d-px-[24] xl:fl-d-gap-[128] 2xl:max-w-480 2xl:justify-center">
      {/* Gallery */}
      <div className="lg:w-[48%] lg:fl-d-max-w-[668] lg:fl-d-pt-[22]">
        {/* Mobile: swipeable carousel */}
        <div
          className="relative fl-m-m-[16] aspect-4/5 cursor-grab overflow-hidden active:cursor-grabbing lg:hidden"
          onTouchStart={(e) => {
            startX.current = e.touches[0]?.clientX ?? 0;
          }}
          onTouchEnd={(e) => {
            const dx = (e.changedTouches[0]?.clientX ?? 0) - startX.current;
            if (dx > 40) prev();
            else if (dx < -40) next();
          }}
        >
          <Img
            src={gallery.images[current]?.src ?? ''}
            alt={gallery.images[current]?.alt ?? ''}
            width={360}
            height={450}
            priority
            sizes="100vw"
            className="size-full object-cover"
          />
          {gallery.images.length > 1 && (
            <div
              className="absolute fl-m-bottom-[12] fl-m-left-[16] flex items-center fl-m-gap-[10]"
              aria-hidden="true"
            >
              {gallery.images.map((img, i) => (
                <button
                  key={img.src}
                  type="button"
                  onClick={() => startStateTransition(() => setCurrent(i))}
                  className={`fl-m-size-[6] cursor-pointer rounded-full backdrop-blur-sm transition-colors ${
                    i === current ? 'bg-white' : 'bg-dim/40'
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Desktop: main image + right thumbnail strip */}
        <div className="hidden fl-d-gap-[8] lg:flex">
          <div className="flex-1 aspect-616/767 overflow-hidden">
            <Img
              src={gallery.images[current]?.src ?? ''}
              alt={gallery.images[current]?.alt ?? ''}
              width={616}
              height={767}
              priority
              sizes="616px"
              className="h-full w-full object-cover"
            />
          </div>
          <div className="flex fl-d-w-[44] shrink-0 flex-col fl-d-gap-[8]">
            {gallery.images.map((img, i) => (
              <button
                key={img.src}
                type="button"
                aria-label={`View image ${i + 1}`}
                onClick={() => startStateTransition(() => setCurrent(i))}
                className={`fl-d-h-[56] fl-d-w-[44] shrink-0 cursor-pointer overflow-hidden border transition-colors ${
                  i === current ? 'border-ink/30' : 'border-transparent'
                }`}
              >
                <Img
                  src={img.src}
                  alt={img.alt}
                  width={44}
                  height={56}
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Info panel */}
      <div className="flex flex-col fl-px-[16,16] lg:w-[40%] lg:self-start lg:sticky lg:p-0 lg:fl-d-pt-[45] xl:fl-d-pr-[104]">
        <h1 className="fl-text-[16,16] leading-[1.3] tracking-[0.02em] font-medium text-ink wrap-break-word fl-mb-[24,20]">
          {data.title}
        </h1>
        <div className="flex flex-col fl-gap-[20,20]">
          {/* Pair product cards */}
          <div className="grid grid-cols-2 fl-gap-[8,12]">
            {data.items.map((item) => (
              <div key={item.handle} className="flex flex-col fl-gap-[12,16]">
                <Alink
                  href={`/products/${item.handle}`}
                  className="aspect-3/4 w-full overflow-hidden bg-surface-muted lg:aspect-auto lg:fl-d-h-[320]"
                  aria-label={`View ${item.name}`}
                >
                  <Img
                    src={item.image}
                    alt={item.imageAlt}
                    width={228}
                    height={239}
                    className="h-full w-full object-cover"
                    sizes="(max-width: 1024px) 152px, 228px"
                  />
                </Alink>
                <div className="flex flex-col fl-gap-[8,12]">
                  <span className="fl-text-[14,14] leading-none tracking-[0.02em] text-dim">
                    ₹ {item.price.toLocaleString('en-IN')}
                  </span>
                  <Button
                    variant="none"
                    onClick={() => handleAddToBag(item)}
                    className="flex w-fit items-center fl-gap-[6,6] fl-text-[12,14] leading-none tracking-[0.03em] lg:tracking-[0.02em] text-ink"
                    aria-label={`Add ${item.name} to bag`}
                  >
                    <PlusIcon className="fl-size-[12,14] shrink-0" />
                    ADD TO BAG
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <hr className="divider" />

          {/* Color options */}
          <div className="fl-pb-[8,8] lg:pb-0">
            <ColorSwatchGrid
              colors={data.colors}
              currentHandle={currentHandle}
              productTitle={data.title}
            />
          </div>
        </div>

        <Accordions data={data.accordions} />
      </div>
    </section>
  );
};
