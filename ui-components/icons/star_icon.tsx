export const StarIcon = ({
  className = '',
  filled = true,
}: {
  className?: string;
  filled?: boolean;
}) => (
  <svg
    viewBox="0 0 12 12"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`overflow-visible ${className}`}
    aria-hidden="true"
  >
    {filled ? (
      <path
        d="M5.99986 0L7.99967 4.49769L12 4.99747L8.99957 7.49617L9.99947 11.9939L5.99986 9.49502L1.99995 11.9939L2.99993 7.49617L0 4.99747L3.9999 4.49769L5.99986 0Z"
        fill="currentColor"
      />
    ) : (
      // Inset outline star — the empty / partial (pointer) value
      <path
        d="M7.54297 4.70117L7.65723 4.95898L7.9375 4.99414L10.7939 5.34961L8.67969 7.1123L8.44531 7.30664L8.51172 7.60449L9.25195 10.9375L6.26465 9.07129L6 8.90527L5.73535 9.07129L2.74707 10.9375L3.48828 7.60449L3.55371 7.30664L3.32031 7.1123L1.20508 5.34961L4.06152 4.99414L4.3418 4.95898L4.45703 4.70117L6 1.23047L7.54297 4.70117Z"
        stroke="currentColor"
      />
    )}
  </svg>
);

// This star's mass sits mostly left-of-center (its 5 points converge there); a plain
// width clip at e.g. 75% only trims the thin right-hand point, so it reads as ~89%
// filled by area — a 4.7 rating's last star looked indistinguishable from a full one.
// This table maps "intended fill" (fraction of the rating, by area) to the clip-width%
// that actually renders that much visible area, sampled every 10% off the star's own
// polygon and interpolated between points.
const AREA_TO_CLIP_WIDTH: [fillPercent: number, clipWidthPercent: number][] = [
  [0, 0],
  [10, 24.3],
  [20, 31.5],
  [30, 38.7],
  [40, 44.7],
  [50, 50],
  [60, 55.3],
  [70, 61.3],
  [80, 68.4],
  [90, 75.7],
  [100, 100],
];

const clipWidthForFill = (fillPercent: number): number => {
  const table = AREA_TO_CLIP_WIDTH;
  for (let i = 0; i < table.length - 1; i++) {
    const [f0, w0] = table[i] as (typeof table)[number];
    const [f1, w1] = table[i + 1] as (typeof table)[number];
    if (fillPercent <= f1) {
      const t = (fillPercent - f0) / (f1 - f0);
      return w0 + t * (w1 - w0);
    }
  }
  return 100;
};

/** Area-accurate clip-width% for the star at `index`, given a 0-5 `rating`. */
export const getStarFill = (rating: number, index: number): number => {
  const remaining = Math.max(0, Math.min(1, rating - index)) * 100;
  return Math.round(clipWidthForFill(remaining) * 10) / 10;
};
