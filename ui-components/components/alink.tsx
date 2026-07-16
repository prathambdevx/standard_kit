'use client';

import Link from 'next/link';
import { forwardRef, isValidElement, memo, useCallback, useMemo } from 'react';

import { RippleLayer, useRipple } from '@/components/ui/ripple';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/cn';

// Any link to the About Us page fires about_us_click — catch-all by destination
// (the link label is Strapi-driven, so we never match on text).
const ABOUT_US_HREF = '/pages/about-us';

interface LinkStyleProps {
  disabled?: boolean;
  /** Opt out of the auto cta_click — set on links that already fire a dedicated
   *  event (footer_click, navigation_menu_click, select_item, …) to avoid double-counting. */
  noCta?: boolean;
  /** section_name for the auto cta_click (e.g. "Daily Drops"); defaults to 'NA'. */
  ctaSection?: string;
  /** product_name for the auto cta_click (e.g. "Washed Oxford Shirt"); defaults to 'NA'. */
  ctaProduct?: string;
  /** Material-style click ripple (icon/logo links). Host is made `relative`; add
   *  `rounded-full` on the link so the ripple clips round, not squarish. */
  ripple?: boolean;
}

interface GenericLinkProps extends React.ComponentPropsWithoutRef<typeof Link>, LinkStyleProps {}

const PASSTHROUGH_HREF = /^([a-zA-Z][a-zA-Z\d+\-.]*:|\/|#|\?|\/\/|$)/;

// cta_text = the link's visible label. Walks children for the first string —
// handles a plain string, "text + icon" (CtaLink: [label, <Arrow/>]) and a
// wrapping element (<Button>VIEW ALL</Button>). Falls back to 'NA' when the
// link has no text (icon-only links).
const ctaTextFromChildren = (children: React.ReactNode): string => {
  const walk = (node: React.ReactNode): string | undefined => {
    if (typeof node === 'string') return node.trim() || undefined;
    if (typeof node === 'number') return String(node);
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = walk(child);
        if (found) return found;
      }
      return undefined;
    }
    if (isValidElement(node)) {
      return walk((node.props as { children?: React.ReactNode }).children);
    }
    return undefined;
  };
  return walk(children) ?? 'NA';
};

export const resolveAlinkHref = (href: GenericLinkProps['href']) => {
  if (typeof href !== 'string' || PASSTHROUGH_HREF.test(href)) return href;
  return `/${href}`;
};

export const Alink = memo(
  forwardRef<HTMLAnchorElement, GenericLinkProps>(
    (
      {
        href,
        children,
        className = '',
        disabled,
        noCta,
        ctaSection,
        ctaProduct,
        ripple,
        // Links default to no prefetch (avoids mass-prefetching PLP grids); a
        // high-intent, stable route (e.g. /cart) opts in with prefetch.
        prefetch = false,
        onClick,
        onPointerDown,
        ...props
      },
      ref,
    ) => {
      const resolvedHref = resolveAlinkHref(href);
      const { ripples, onPointerDown: onRipplePointerDown, clear } = useRipple(!!ripple);

      const handleClick = useCallback(
        (e: React.MouseEvent<HTMLAnchorElement>) => {
          onClick?.(e);
          const ctaText = ctaTextFromChildren(children);
          // The About Us page has its own dedicated event — fire it instead of
          // the generic cta_click. Runs before navigation, so it counts even on
          // new-tab/modified/external clicks.
          if (typeof resolvedHref === 'string' && resolvedHref.includes(ABOUT_US_HREF)) {
            track.content.aboutUsClick({
              sectionName: 'NA',
              ctaText,
              linkPath: resolvedHref,
            });
            return;
          }
          // Auto cta_click catch-all — skipped on links that already fire a
          // dedicated event (they pass noCta). section/product default to 'NA'.
          if (!noCta) {
            track.nav.cta(ctaText, { sectionName: ctaSection, productName: ctaProduct });
          }
        },
        [onClick, resolvedHref, children, noCta, ctaSection, ctaProduct],
      );

      const linkClasses = useMemo(
        () =>
          cn(
            // Base styles
            'transition-all duration-200',
            // Ripple needs a positioning context for its clip layer
            ripple && 'relative',
            // Optional styles
            disabled && 'pointer-events-none',

            // Custom classes
            className,
          ),
        [disabled, ripple, className],
      );

      if (disabled) {
        return (
          <span className={linkClasses} ref={ref}>
            {children}
          </span>
        );
      }

      return (
        <Link
          href={resolvedHref || '#'}
          className={linkClasses}
          ref={ref}
          prefetch={prefetch}
          onClick={handleClick}
          onPointerDown={(event) => {
            onPointerDown?.(event);
            onRipplePointerDown(event);
          }}
          {...props}
        >
          {children}
          {ripple && <RippleLayer ripples={ripples} onClear={clear} />}
        </Link>
      );
    },
  ),
);

Alink.displayName = 'Alink';
