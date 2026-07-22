import type { GalleryBadge } from '@/types/components/pdp/gallery';

const LABEL: Record<GalleryBadge, string> = { new: 'New', sale: 'Sale' };
const STYLE: Record<GalleryBadge, string> = {
  new: 'bg-ink text-white',
  sale: 'bg-status-error text-white',
};

/** "New" / "Sale" chip pinned to the top-left of the gallery's first image. */
export const GalleryBadgeChip = ({ badge }: { badge: GalleryBadge }) => (
  <span
    className={`pointer-events-none absolute flex justify-center items-center text-center z-10 fl-m-top-[16] fl-m-left-[16] rounded-[4px] fl-h-[16,20] fl-w-[38,38] fl-text-[10,12] leading-none tracking-[0.02em] lg:tracking-[0.03em] ${STYLE[badge]}`}
  >
    {LABEL[badge]}
  </span>
);
