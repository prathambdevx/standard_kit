// REFERENCE, not drop-in: the real production integration of ../hooks/useRailGpuWindow.ts.
// Project-specific imports (analytics, commerce session, EdgeScroll, Glood) won't resolve
// outside its home repo — read it for the wiring: windowed slice via useRailGpuWindow, the
// merged section observers, and analytics kept on the FULL product list.

'use client';

import { useCallback } from 'react';
import { CircleArrowLeftIcon } from '@/assets/icons/circle_arrow_left_icon';
import { CircleArrowRightIcon } from '@/assets/icons/circle_arrow_right_icon';
import { ProductCard, type ProductCardVariant } from '@/components/common/product_card';
import { Alink } from '@/components/ui/alink';
import { Button } from '@/components/ui/button';
import { EdgeScroll } from '@/components/ui/edge_scroll';
import { ProductCount } from '@/components/ui/product_count';
import { useRailGpuWindow } from '@/hooks/useRailGpuWindow';
import { useScrollerWithArrows } from '@/hooks/useScrollerWithArrows';
import {
  analytics,
  cardDataToItem,
  rememberListItems,
  setCurrentList,
  toItemAttribution,
  track,
  useInViewOnce,
} from '@/lib/analytics';
import { gloodTrack } from '@/lib/analytics/glood_events';
import { cn } from '@/lib/cn';
import { commerce } from '@/lib/commerce';
import type { ProductRailData } from '@/types/components/pdp/product_rail';
import { resolveTemplate } from '@/utils/helpers';

// `small` card width: fl-basis-[192,342] carries 192px@360 → 342px@1440 (unchanged);
// rail-card-sm-wide takes over from 1440 → 462px@1920 (container-fraction w/ cap —
// see globals.css). medium/large are container-relative one/two-up slots, not
// vw-based (real `100vw` overflows on Windows — skill hard rule 3).
const CARD_SLOT: Record<ProductCardVariant, string> = {
  small: 'fl-basis-[192,342] rail-card-sm-wide',
  medium: 'w-[calc(50%-4px)] lg:w-[357px]',
  large: 'w-full lg:w-[478px]',
};

// Per-click scroll distance ≈ one desktop card width + the 8px gap.
const CARD_STEP: Record<ProductCardVariant, number> = {
  small: 350,
  medium: 365,
  large: 486,
};

// Cards mounted before the rail is first scrolled — ~3 phone-screens of runway, so the swap-in
// is never visible. See useRailGpuWindow for why this exists.
const RAIL_WINDOW = 6;

export const ProductRail = ({
  data,
  cardVariant = 'small',
  sectionClass = '',
  gloodSection,
}: {
  data: ProductRailData;
  cardVariant?: ProductCardVariant;
  sectionClass?: string;
  // Set only by Glood rec rails — fires this rail's impression and attributes an add-to-bag to it.
  // `parentProductId` is the PDP product the recs hang off (absent on home/cart rails).
  gloodSection?: { id: number; serveId: string; type: string; parentProductId?: string };
}) => {
  const { heading: rawHeading, count, viewAllHref, products } = data;
  const { node, setRefs, scrollLeft, scrollRight, canScrollLeft, canScrollRight, progress } =
    useScrollerWithArrows<HTMLDivElement>(CARD_STEP[cardVariant]);

  // See useRailGpuWindow: vertical page scroll re-tiles for free on iOS, this rail's own
  // horizontal scroll doesn't, so we window it to keep its GPU layer small until it's touched.
  const { containerRef: inViewRef, visibleCount } = useRailGpuWindow<HTMLDivElement, HTMLElement>(
    node,
    products.length,
    RAIL_WINDOW,
  );
  const visibleProducts = products.slice(0, visibleCount);

  const firstName = commerce.useSession((s) => s.customer?.firstName);
  const heading = resolveTemplate(rawHeading, firstName);

  // view_item_list — fire once when the rail scrolls into view; setCurrentList so
  // a card click's select_item → view_item stays attributed to this rail.
  const sectionRef = useInViewOnce<HTMLElement>(() => {
    // No sort/filter on a rail — item_category4 is 'NA' per the spec.
    const list = { item_list_name: heading, item_category4: 'NA' };
    setCurrentList(list);
    const entries = products.map((product, i) => ({
      handle: product.handle,
      item: cardDataToItem(product, { index: i + 1, ...list }),
    }));
    analytics.viewItemList({ items: entries.map((e) => e.item), item_list_name: heading });
    rememberListItems(entries.map((e) => ({ handle: e.handle, attr: toItemAttribution(e.item) })));
    // Glood impression — the CTR denominator, so it rides the same real-visibility trigger as
    // view_item_list. A rail rendered off-screen from cached sections data must not count as seen.
    if (gloodSection) {
      gloodTrack.sectionViewed(gloodSection, products, gloodSection.parentProductId);
    }
  });

  // One <section>, two observers: the once-only analytics ref above + the two-way window ref.
  const setSectionRefs = useCallback(
    (el: HTMLElement | null) => {
      sectionRef.current = el;
      inViewRef.current = el;
    },
    [sectionRef, inViewRef],
  );

  // Product rail → single product_name doesn't apply; facade defaults it to 'NA'.
  const handleScrollLeft = () => {
    track.pdp.arrow('left_arrow', { sectionName: heading });
    scrollLeft();
  };
  const handleScrollRight = () => {
    track.pdp.arrow('right_arrow', { sectionName: heading });
    scrollRight();
  };

  // Cards fit the viewport → no overflow; hide the arrows.
  const isScrollable = progress.width < 1;

  if (products.length === 0) return null;

  return (
    <section
      ref={setSectionRefs}
      data-product-rail
      aria-label={heading}
      className={cn(
        '@container flex flex-col fl-gap-[16,20] overflow-x-hidden fl-px-[16,24] fl-py-[32,48]',
        sectionClass,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        {/* Long headings wrap on mobile instead of squeezing the VIEW ALL button
            (desktop stays single-line); count is inline so it follows the last
            heading word rather than being pushed right when the heading wraps. */}
        <h2 className="min-w-0 fl-text-[20,28] font-normal leading-[1.2] tracking-[0.01em] lg:leading-none lg:tracking-normal lg:whitespace-nowrap text-ink">
          {heading}
          {count && <ProductCount count={count} />}
        </h2>

        <div className="flex shrink-0 items-center gap-6">
          {viewAllHref && (
            <Alink href={viewAllHref} prefetch ctaSection={heading}>
              <Button variant="outline" size="sm" className="fl-py-[7,12]">
                VIEW ALL
              </Button>
            </Alink>
          )}

          {/* Arrow nav — desktop only, and only when the rail overflows */}
          {isScrollable && (
            <div className="hidden items-center fl-d-gap-[8] lg:flex">
              <Button
                variant="none"
                ripple
                aria-label="Scroll left"
                onClick={handleScrollLeft}
                disabled={!canScrollLeft}
                className="rounded-full text-dim transition-colors hover:text-ink disabled:opacity-40"
              >
                <CircleArrowLeftIcon className="fl-d-size-[40]" />
              </Button>
              <Button
                variant="none"
                ripple
                aria-label="Scroll right"
                onClick={handleScrollRight}
                disabled={!canScrollRight}
                className="rounded-full text-dim transition-colors hover:text-ink disabled:opacity-40"
              >
                <CircleArrowRightIcon className="fl-d-size-[40]" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Product rail — native snap scroll, bleeds end-to-end into the right viewport edge. */}
      <EdgeScroll ref={setRefs} gap="gap-2" snap="none" fluid>
        {visibleProducts.map((product) => (
          <div key={product.id} className={`shrink-0 ${CARD_SLOT[cardVariant]}`}>
            <ProductCard data={product} variant={cardVariant} gloodSection={gloodSection} />
          </div>
        ))}
      </EdgeScroll>
    </section>
  );
};
