'use client';

interface CarouselDotsProps {
  count: number;
  active: number;
  onChange?: (index: number) => void;
  className?: string;
  /** Fluidly scales the bars from mobile (hero figma: 2px thick, 16/8px wide) to desktop. */
  responsive?: boolean;
  /** Bar color for the backdrop behind the dots — `light` (white, over dark) or `dark` (ink, over light). */
  tone?: 'light' | 'dark';
}

export const CarouselDots = ({
  count,
  active,
  onChange,
  className = '',
  responsive = false,
  tone = 'light',
}: CarouselDotsProps) => {
  const bar = responsive
    ? { base: 'fl-h-[2,4]', active: 'fl-w-[16,40]', inactive: 'fl-w-[8,16]' }
    : { base: 'h-1', active: 'w-10', inactive: 'w-4' };
  const fill =
    tone === 'dark'
      ? { active: 'bg-ink', inactive: 'bg-ink/40' }
      : { active: 'bg-white', inactive: 'bg-white/50' };
  return (
    <div className={`flex items-center gap-2 ${className}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <button
          // biome-ignore lint/suspicious/noArrayIndexKey: dot order is stable
          key={i}
          type="button"
          onClick={() => onChange?.(i)}
          className={`block ${bar.base} rounded-full transition-all duration-300 ${
            onChange ? 'cursor-pointer' : 'cursor-default'
          } ${i === active ? `${bar.active} ${fill.active}` : `${bar.inactive} ${fill.inactive}`}`}
        />
      ))}
    </div>
  );
};
