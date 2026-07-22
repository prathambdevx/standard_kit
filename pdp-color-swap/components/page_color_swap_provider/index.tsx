'use client';

import type { ReactNode } from 'react';

import type { BffProduct } from '@/services/bff/pdp';

import { ColorSwapContextProvider, useColorSwap } from '../../hooks/useColorSwap';

/** Owns the active colour for the entire PDP page. Wrap the full view with this
 *  so ProductHero and below-fold sections all read the same active product. */
export const PageColorSwapProvider = ({
  initialProduct,
  children,
}: {
  initialProduct: BffProduct;
  children: ReactNode;
}) => {
  const { product, isSwapping, swapTo, pendingHandle, prefetchHandles } =
    useColorSwap(initialProduct);

  return (
    <ColorSwapContextProvider
      value={{
        activeHandle: pendingHandle ?? product.handle,
        isSwapping,
        onSelect: swapTo,
        product,
        prefetchHandles,
      }}
    >
      {children}
    </ColorSwapContextProvider>
  );
};
