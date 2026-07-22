'use client';

import { cn } from '@/lib/cn';

import { ProductConfigurator } from '../../configurators/product_configurator';
import type { PdpInitialSelection } from '../../configurators/types';
import { useColorSwapContext } from '../../hooks/useColorSwap';
import { toAccordionsData, toGalleryData, toInfoBaseData } from '../../mappers';
import { Accordions } from '../accordions';
import { Gallery } from '../gallery';
import { InfoBase } from '../info_base';

/** PDP hero. Reads the active colour from PageColorSwapProvider — no swap logic
 *  here, just rendering. Configurator re-keys per colour to reset size selection. */
export const ProductHero = ({
  initialHandle,
  initialSelection,
}: {
  /** Handle of the server-rendered entry colour — only used to detect when a
   *  deep-link selection (size/height from a wishlist item) should be applied. */
  initialHandle: string;
  initialSelection?: PdpInitialSelection;
}) => {
  const swap = useColorSwapContext();
  if (!swap) return null;
  const { product } = swap;

  const gallery = toGalleryData(product);
  const info = toInfoBaseData(product);
  const accordions = toAccordionsData(product);

  const singleColumn = gallery.singleColumnDesktop;
  // Deep-link selection only applies to the entry colour — swaps start fresh.
  const selection = product.handle === initialHandle ? initialSelection : undefined;

  return (
    <section
      className={cn(
        'flex flex-col lg:flex-row lg:fl-d-pb-[48]',
        !singleColumn && 'lg:fl-d-gap-[40]',
      )}
    >
      <div
        className={cn(
          'lg:min-w-0',
          singleColumn ? 'lg:w-1/2 fl-pl-[0,24] fl-pt-[0,24]' : 'lg:flex-1',
        )}
      >
        <Gallery data={gallery} productName={product.title} swapKey={product.handle} />
      </div>
      {/* Info column — sticky below the fluid header (fl-d-top-[60] tracks fl-d-h-[60]); the gallery scrolls past it, then both scroll on to the sections below */}
      <div
        className={cn(
          'fl-px-[16,16] fl-m-pt-[16] lg:fl-d-pt-[96] lg:pb-0 lg:self-start lg:sticky lg:fl-d-top-[60]',
          singleColumn
            ? 'lg:w-1/2 lg:min-w-0 fl-px-[16,32] xl:fl-d-px-[136] 2xl:fl-d-max-w-[800]'
            : 'lg:fl-d-w-[500] lg:shrink-0 lg:pl-0 lg:fl-d-pr-[56]',
        )}
      >
        <InfoBase data={info} fullWidthConfig>
          {/* Re-key on handle so size/height selection resets per colour */}
          <ProductConfigurator
            key={product.handle}
            product={product}
            initialSelection={selection}
          />
        </InfoBase>
        <Accordions data={accordions} />
      </div>
    </section>
  );
};
