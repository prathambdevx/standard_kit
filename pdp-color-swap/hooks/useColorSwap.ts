'use client';

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { storeSdk } from '@/lib/commerce';
import { startStateTransition } from '@/lib/view_transition';
import type { BffProduct } from '@/services/bff/pdp';

// Matches VISIBLE_COLORS in ColorSwatchGrid (5 slots total, 1 is the current product).
const INITIAL_PREFETCH_LIMIT = 4;

type ColorSwap = {
  /** Handle of the product currently shown — drives swatch highlighting. */
  activeHandle: string;
  /** True while the next colour's product is being fetched. */
  isSwapping: boolean;
  onSelect: (handle: string) => void;
  /** Full active product — consumed by ProductHero to derive gallery/info/accordions. */
  product: BffProduct;
  /** Prefetch specific sibling handles — called when the +N swatch overflow is expanded. */
  prefetchHandles: (handles: string[]) => void;
};

const ColorSwapContext = createContext<ColorSwap | null>(null);
// Provider is wired up only by PageColorSwapProvider; every other component reads
// the active colour through useColorSwapContext.
export const ColorSwapContextProvider = ColorSwapContext.Provider;
export const useColorSwapContext = () => useContext(ColorSwapContext);

// next.config.ts deviceSizes — the browser picks the smallest entry that covers
// the image's needed pixels (CSS display width × DPR).
const DEVICE_SIZES = [320, 640, 750, 828, 1080, 1200, 1440, 1920] as const;

// Returns the width the gallery will actually request from Shopify CDN, matching
// the Img imageLoader (dpr=2 hardcoded) + Next.js deviceSizes selection.
//   Mobile  (<1024px): MobileCarousel Img width={720} sizes="100vw" → pick nearest
//             deviceSize ≥ (innerWidth × DPR), capped at maxWidth=1440.
//   Desktop (≥1024px): DesktopGrid main col Img width={446} → maxWidth=892.
// Aligning here avoids cache misses — the browser HTTP cache is keyed on exact URL.
function heroImageWidth(): number {
  if (window.innerWidth >= 1024) return 892;
  const needed = Math.round(window.innerWidth * (window.devicePixelRatio || 2));
  return DEVICE_SIZES.find((s) => s >= Math.min(needed, 1440)) ?? 1440;
}

// Warms the hero image in the browser cache before the crossfade fires.
function preloadHeroImage(url: string | undefined): Promise<void> {
  if (!url) return Promise.resolve();
  const width = heroImageWidth();
  const sep = url.includes('?') ? '&' : '?';
  const sized = url.includes('cdn.shopify.com') ? `${url}${sep}width=${width}&q=75` : url;
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const img = new window.Image();
    img.onload = finish;
    img.onerror = finish;
    img.src = sized;
    img
      .decode?.()
      .then(finish)
      .catch(() => {});
    setTimeout(finish, 1200);
  });
}

/**
 * Swaps the PDP between sibling-colour products in place — no route remount, no
 * scroll reset, no loading skeleton. The URL still updates (History API) so
 * refresh/deep-link/SSR keep serving the right colour, and back/forward within
 * the colour family re-derive the product from the URL.
 */
export function useColorSwap(initialProduct: BffProduct) {
  const [product, setProduct] = useState(initialProduct);
  const [isSwapping, setIsSwapping] = useState(false);
  // Set immediately on tap so the swatch ring moves before the fetch resolves.
  const [pendingHandle, setPendingHandle] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Stable swatch order from the server-rendered product — each sibling product
  // in Shopify may list its product_variants in a different order, so locking to
  // the initial order prevents swatches from reordering when a colour is swapped.
  const stableSwatchOrderRef = useRef(initialProduct.colorSwatches.map((s) => s.handle));

  const handleRef = useRef(product.handle);
  handleRef.current = product.handle;
  const reqRef = useRef(0);
  const siblingsRef = useRef<Set<string>>(new Set());
  // Kept current every render — sibling handles in this colour family.
  // Only these are adopted on popstate; unrelated routes are left to the router.
  siblingsRef.current = new Set([product.handle, ...product.colorSwatches.map((s) => s.handle)]);

  // A full navigation landed a different product — adopt it as the new baseline.
  useEffect(() => {
    setProduct(initialProduct);
  }, [initialProduct]);

  const load = useCallback(
    async (handle: string) => {
      if (!handle || handle === handleRef.current) return;
      const reqId = ++reqRef.current;
      setIsSwapping(true);
      setPendingHandle(handle);
      let committed = false;
      try {
        const next = await queryClient.fetchQuery({
          queryKey: ['pdp-product', handle],
          queryFn: () => storeSdk.products.get(handle),
          staleTime: 5 * 60_000,
        });
        // A newer tap superseded this fetch — discard the stale result.
        if (reqId !== reqRef.current) return;
        if (!next) {
          // Handle vanished from Shopify — fall back to a real navigation (→ 404).
          window.location.assign(`/products/${handle}`);
          return;
        }
        // Warm the first image so the crossfade lands on a painted gallery.
        await preloadHeroImage(next.images[0]?.url);
        if (reqId !== reqRef.current) return;
        // replaceState so browser-back exits the PDP rather than cycling colour-by-colour.
        window.history.replaceState(null, '', `/products/${handle}`);
        committed = true;
        // Reorder the swapped product's colorSwatches to match the stable initial
        // order — each Shopify product may list its siblings differently.
        const stableOrder = stableSwatchOrderRef.current;
        const sortedNext = {
          ...next,
          colorSwatches: [...next.colorSwatches].sort((a, b) => {
            const ai = stableOrder.indexOf(a.handle);
            const bi = stableOrder.indexOf(b.handle);
            return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
          }),
        };
        startStateTransition(() => {
          setProduct(sortedNext);
          setIsSwapping(false);
          setPendingHandle(null);
        });
      } catch {
        setPendingHandle(null);
        window.location.assign(`/products/${handle}`);
      } finally {
        // Only clear on the error path — success clears inside startStateTransition.
        if (!committed && reqId === reqRef.current) {
          setIsSwapping(false);
          setPendingHandle(null);
        }
      }
    },
    [queryClient],
  );

  // During idle: warm each sibling's hero image + prefetch its full product JSON so
  // any colour tap — even a cold first visit — resolves from cache at ~0 ms.
  const prefetchedRef = useRef<Set<string>>(new Set());
  // Prefetch a set of sibling handles — image + JSON. Used both by idle startup
  // (visible swatches) and by the +N expansion (hidden swatches revealed on demand).
  const prefetchBatch = useCallback(
    (handles: string[]) => {
      const fresh = handles.filter((h) => !prefetchedRef.current.has(h));
      if (fresh.length === 0) return;
      for (const h of fresh) prefetchedRef.current.add(h);
      const swatchMap = new Map(product.colorSwatches.map((s) => [s.handle, s]));
      for (const h of fresh) {
        const swatch = swatchMap.get(h);
        if (swatch?.firstImageUrl) void preloadHeroImage(swatch.firstImageUrl);
        void queryClient.prefetchQuery({
          queryKey: ['pdp-product', h],
          queryFn: () => storeSdk.products.get(h),
          staleTime: 5 * 60_000,
        });
      }
    },
    [product.colorSwatches, queryClient],
  );

  useEffect(() => {
    // Only prefetch the initially visible swatches (up to INITIAL_PREFETCH_LIMIT).
    // Hidden swatches (+N) are prefetched lazily via prefetchHandles when expanded.
    const visibleSiblings = product.colorSwatches
      .filter((s) => s.handle !== product.handle)
      .slice(0, INITIAL_PREFETCH_LIMIT)
      .map((s) => s.handle);
    if (visibleSiblings.length === 0) return;

    const start = () => prefetchBatch(visibleSiblings);

    // Defer to idle so warming never competes with the initial paint / LCP.
    const supportsIdle = typeof window.requestIdleCallback === 'function';
    const id = supportsIdle ? window.requestIdleCallback(start) : window.setTimeout(start, 1500);
    return () => {
      if (supportsIdle) window.cancelIdleCallback(id as number);
      else window.clearTimeout(id as number);
    };
  }, [product, prefetchBatch]);

  const swapTo = useCallback((handle: string) => void load(handle), [load]);
  const prefetchHandles = useCallback(
    (handles: string[]) => prefetchBatch(handles),
    [prefetchBatch],
  );

  return { product, isSwapping, swapTo, pendingHandle, prefetchHandles };
}
