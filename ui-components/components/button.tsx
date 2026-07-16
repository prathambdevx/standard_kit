'use client';

import { forwardRef, memo, useMemo } from 'react';

import { LoadingSpinner } from '@/components/ui/loading_spinner';
import { RippleLayer, useRipple } from '@/components/ui/ripple';
import { cn } from '@/lib/cn';

type Variant = 'solid' | 'outline' | 'white' | 'ghost' | 'none';
type Size = 'sm' | 'md';

interface ButtonStyleProps {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  // Material-style click ripple. Unset → on for styled CTA variants (solid/white/outline/ghost),
  // off for `none` (icon/custom buttons). Pass explicitly to override either way.
  ripple?: boolean;
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyleProps {}

// Always applied — `none` (icon/custom buttons) gets only this and brings its own sizing.
const baseStyles = 'flex-center outline-hidden transition-all duration-200 cursor-pointer';

// Ripple needs a positioning context only. The clip lives on a dedicated inset
// layer (see JSX) — NOT overflow-hidden on the button itself, which would also
// clip intentionally-protruding children like a status RedDot (-bottom-2 etc.).
const rippleStageStyles = 'relative';

// Shape + type ramp shared by every styled variant. leading-none is load-bearing —
// the previous fixed mobile type step's 130% line-height rendered md buttons at
// ~43.6px instead of the design's 40px; a flat lh:1 ratio is what makes the paddings
// below land on the exact design heights (28/40 sm, 40/48 md) at both anchors.
const shapeStyles =
  'rounded-full uppercase fl-text-[12,14] leading-none tracking-[0.03em] lg:tracking-[0.02em]';

// Dimensions per (variant, size) — white's desktop px bump and ghost's mobile py quirk
// only ever worked today via tw-merge modifier-group semantics + cn() ordering (a bare
// `py-2` surviving alongside a differently-modifiered `lg:py-*`); a single fl-py pair
// per variant can't reproduce that, so every variant gets its own explicit size record
// instead of layering overrides on top of a shared one.
const paddingStyles: Record<Exclude<Variant, 'none'>, Record<Size, string>> = {
  solid: { sm: 'fl-px-[21,33] fl-py-[8,13]', md: 'fl-px-[21,33] fl-py-[14,17]' },
  outline: { sm: 'fl-px-[21,33] fl-py-[8,13]', md: 'fl-px-[21,33] fl-py-[14,17]' },
  white: { sm: 'fl-px-[21,36] fl-py-[8,13]', md: 'fl-px-[21,36] fl-py-[14,17]' },
  ghost: { sm: 'fl-px-[21,33] fl-py-[8,13]', md: 'fl-px-[21,33] fl-py-[8,17]' },
};

// Colour/border only — sizing now lives entirely in paddingStyles above.
const variantStyles: Record<Variant, string> = {
  solid: 'bg-ink text-white whitespace-nowrap transition-opacity hover:opacity-90',
  outline: 'border border-dim/60 text-ink transition-colors hover:border-dim',
  white: 'bg-white text-ink transition-opacity hover:opacity-90',
  ghost: 'border border-white/70 text-white transition-colors hover:bg-white/10',
  none: '',
};

export const Button = memo(
  forwardRef<HTMLButtonElement, ButtonProps>(
    (
      {
        children,
        className = '',
        variant = 'none',
        size = 'md',
        loading,
        disabled,
        ripple,
        type = 'button',
        onPointerDown,
        ...props
      },
      ref,
    ) => {
      // Explicit prop wins; otherwise styled CTA variants ripple, `none` (icons/custom) doesn't.
      const rippleEnabled = ripple ?? variant !== 'none';
      const { ripples, onPointerDown: onRipplePointerDown, clear } = useRipple(rippleEnabled);

      const buttonClasses = useMemo(
        () =>
          cn(
            baseStyles,
            rippleEnabled && rippleStageStyles,
            variant !== 'none' && shapeStyles,
            variant !== 'none' && paddingStyles[variant][size],
            // WCAG 2.5.5 floor for primary CTAs — mobile lands ~40px, desktop 48px is unaffected
            variant !== 'none' && size === 'md' && 'min-h-[44px]',
            variantStyles[variant],
            (disabled || loading) && 'cursor-not-allowed opacity-50',
            className,
          ),
        [variant, size, disabled, loading, rippleEnabled, className],
      );

      return (
        <button
          ref={ref}
          type={type}
          className={buttonClasses}
          disabled={disabled || loading}
          onPointerDown={(event) => {
            onPointerDown?.(event);
            onRipplePointerDown(event);
          }}
          {...props}
        >
          {loading ? <LoadingSpinner className="size-5 w-full" /> : children}

          {/* Ripple clip layer — inset + overflow-hidden so ripples stay inside the
              button shape WITHOUT clipping protruding children (status dots).
              Spread the clip to the 8px tap-target hit area ONLY when the button has
              one (box ≪ hit area) — else the ripple bleeds past the visible ring.
              icon/text (`none`) buttons clip round so the ripple isn't a hard square;
              styled variants inherit their pill radius. */}
          <RippleLayer
            ripples={ripples}
            onClear={clear}
            rounded={variant === 'none' ? 'rounded-full' : 'rounded-[inherit]'}
            spread={className.includes('tap-target') ? 8 : 0}
          />
        </button>
      );
    },
  ),
);

Button.displayName = 'Button';
