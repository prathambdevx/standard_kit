'use client';

import { useEffect, useState } from 'react';

import { Alink } from '@/components/ui/alink';
import { Button } from '@/components/ui/button';
import { Img } from '@/components/ui/img';
import { track } from '@/lib/analytics';
import type { ColorSwatch } from '@/types/components/pdp/info_base';

import { useColorSwapContext } from '../../hooks/useColorSwap';

const VISIBLE_COLORS = 5;
const SESSION_KEY = 'pdp-swatches-expanded';
// Toggle to restore the old mobile behavior (scroll to top when a colour swatch swaps
// the product in place). Off by default — the swap keeps the user's scroll position.
const SCROLL_TOP_ON_COLOR_SWAP = false;

function getExpandedHandles(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function persistExpandedHandles(handles: string[]) {
  try {
    const existing = getExpandedHandles();
    for (const h of handles) existing.add(h);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify([...existing]));
  } catch {}
}

type Props = {
  colors: ColorSwatch[];
  currentHandle: string;
  /** Product title — for the colour_select analytics event. */
  productTitle: string;
};

export const ColorSwatchGrid = ({ colors, currentHandle, productTitle }: Props) => {
  const [showAll, setShowAll] = useState(false);
  // When provided (PDP), tapping a swatch swaps the product in place rather than
  // navigating; the active colour comes from the swap state, not the URL.
  const swap = useColorSwapContext();
  const selected = swap?.activeHandle ?? currentHandle;

  // After hydration check sessionStorage — can't do this in useState initializer
  // because server has no sessionStorage, causing a hydration mismatch.
  useEffect(() => {
    if (getExpandedHandles().has(selected)) setShowAll(true);
  }, [selected]);

  if (colors.length === 0) return null;

  // Collapsed by default; surface a hidden active colour into the last visible slot so
  // the selection stays visible (rather than auto-expanding the whole grid).
  const selectedIdx = colors.findIndex((c) => c.name === selected);
  const visible = (() => {
    if (showAll) return colors;
    const head = colors.slice(0, VISIBLE_COLORS);
    const selectedSwatch = colors[selectedIdx];
    if (selectedIdx >= VISIBLE_COLORS && selectedSwatch) head[head.length - 1] = selectedSwatch;
    return head;
  })();
  const hiddenCount = showAll ? 0 : Math.max(0, colors.length - VISIBLE_COLORS);

  const handleShowAll = () => {
    setShowAll(true);
    persistExpandedHandles(colors.map((c) => c.name));
    // Prefetch the hidden swatches now that the user has shown intent by expanding.
    const hiddenHandles = colors.slice(VISIBLE_COLORS).map((c) => c.name);
    if (hiddenHandles.length > 0) swap?.prefetchHandles(hiddenHandles);
  };

  return (
    <div className="flex flex-col fl-gap-[12,12]">
      <span className="fl-text-[14,16] leading-[1.4] tracking-[0.02em] text-ink">
        Color Options:
      </span>
      {/* auto-fill grid: cells fill the row edge-to-edge (no trailing blank); swatch 44/48 centred. */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] fl-gap-[10,16]">
        {visible.map((color) => {
          const isActive = selected === color.name;
          const href = `/products/${color.name}`;
          // Always an <Alink> (real <a href> → crawlable, cmd/right-click work). On
          // the PDP we intercept and swap in place; elsewhere it navigates normally.
          return (
            <Alink
              key={color.name}
              href={href}
              noCta
              aria-label={`View ${color.label}`}
              aria-current={isActive ? 'true' : undefined}
              onClick={(e) => {
                track.pdp.colorSelect(color.label, productTitle, href);
                if (swap) {
                  e.preventDefault();
                  swap.onSelect(color.name);
                  if (SCROLL_TOP_ON_COLOR_SWAP && window.innerWidth < 1024) {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }
                }
              }}
              className="flex flex-col items-center fl-gap-[6,8]"
            >
              <div
                className={`fl-size-[44,48] shrink-0 overflow-hidden rounded-[8px] transition-shadow duration-[var(--motion-duration-fast)] ease-[var(--motion-ease)] ${
                  isActive ? 'ring-1 ring-dim ring-offset-2' : ''
                }`}
              >
                <Img
                  src={color.swatchUrl}
                  alt={color.label}
                  width={48}
                  height={48}
                  className="h-full w-full object-cover"
                />
              </div>
              <span
                className={`fl-text-[11,12] text-center whitespace-nowrap tracking-[0.02em] ${isActive ? 'text-ink' : 'text-dim/80'}`}
              >
                {color.label}
              </span>
            </Alink>
          );
        })}

        {!showAll && hiddenCount > 0 && (
          // +N pill in a swatch-sized slot so it lines up with the swatch row.
          <div className="flex fl-size-[44,48] items-center justify-center justify-self-center">
            <Button
              variant="none"
              type="button"
              aria-label={`Show ${hiddenCount} more colors`}
              onClick={handleShowAll}
              className="flex fl-size-[28,32] shrink-0 items-center justify-center rounded-full border-none bg-dim/10 p-0"
            >
              <span className="font-helvetica fl-text-[11,12] font-normal leading-[0.8] tracking-normal lg:tracking-[0.03em] text-dim">
                +{hiddenCount}
              </span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
