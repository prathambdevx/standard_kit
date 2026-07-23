'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as React from 'react';

import { CrossIcon } from '@/assets/icons/cross_icon';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { cn } from '@/lib/cn';
import { Alink } from './alink';
import { Button } from './button';
import { RippleLayer, useRipple } from './ripple';
import { ScrollArea } from './scroll_area';

const Drawer = DialogPrimitive.Root;

const DrawerTrigger = DialogPrimitive.Trigger;

const DrawerPortal = DialogPrimitive.Portal;

const DrawerClose = DialogPrimitive.Close;

const DrawerOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'drawer-overlay fixed inset-0 z-100 bg-black/50 [view-transition-name:drawer-overlay]',
      className,
    )}
    {...props}
  />
));
DrawerOverlay.displayName = DialogPrimitive.Overlay.displayName;

interface DrawerContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  showClose?: boolean;
}

const DrawerContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  DrawerContentProps
>(({ className, children, ...props }, ref) => {
  const isFromLeft = className?.includes('drawer-from-left');
  const isMobileOnly = className?.includes('drawer-mobile');

  return (
    <DrawerPortal>
      <DrawerOverlay
        className={cn(
          // Full-screen tinted + blurred backdrop — base z-100 sits above the header's z-50,
          // so the header bar is blurred along with the rest of the page.
          isFromLeft ? 'bg-ink/40 backdrop-blur-[6px]' : undefined,
          isMobileOnly ? 'lg:hidden' : undefined,
        )}
      />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'drawer-content bg-surface-alt fixed z-101 flex flex-col [view-transition-name:drawer-content]',
          // Mobile: bottom sheet
          'inset-x-0 bottom-0 max-h-[80dvh] w-full',
          // Tablet + desktop: right-side panel at 488px
          'md:inset-y-0 md:right-0 md:left-auto md:max-h-full md:w-[488px]',
          isMobileOnly ? 'lg:hidden' : undefined,
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DrawerPortal>
  );
});
DrawerContent.displayName = DialogPrimitive.Content.displayName;

const DrawerHeader = ({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'bg-surface-alt border-b border-line-light sticky top-0 z-10 flex items-center justify-between',
      // Mobile bottom sheet: zone-M scaling: 16px/14px
      'fl-m-px-[16] fl-m-py-[14]',
      // Desktop (lg+, frozen panel): 40px/48px
      'lg:px-10 lg:py-12',
      className,
    )}
    {...props}
  >
    {children}
  </div>
);
DrawerHeader.displayName = 'DrawerHeader';

const DrawerFooter = ({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'border-line-light sticky bottom-0 z-10 flex items-center justify-between border-t bg-white shadow-[0px_-4px_20px_0px_rgba(0,0,0,0.05)]',
      // Mobile + tablet: padding 16px + safe area
      'px-4 pt-4 pb-[calc(16px+env(safe-area-inset-bottom))]',
      // Desktop (lg+): padding 16px 40px
      'lg:px-10 lg:py-4',
      className,
    )}
    {...props}
  >
    {children}
  </div>
);
DrawerFooter.displayName = 'DrawerFooter';

const DrawerTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      'text-ink text-center font-normal leading-none',
      // Mobile + tablet: 16px
      'text-[16px]',
      // Desktop (lg+, frozen panel): 20px
      'lg:text-[20px]',
      className,
    )}
    {...props}
  />
));
DrawerTitle.displayName = DialogPrimitive.Title.displayName;

const DrawerDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-dim text-[14px] leading-[1.4]', className)}
    {...props}
  />
));
DrawerDescription.displayName = DialogPrimitive.Description.displayName;

const DrawerCloseButton = ({
  className,
  onPointerDown,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Close>) => {
  const { ripples, onPointerDown: onRipplePointerDown, clear } = useRipple();
  return (
    <DialogPrimitive.Close
      data-testid="drawer-close-btn"
      onPointerDown={(event) => {
        onPointerDown?.(event);
        onRipplePointerDown(event);
      }}
      className={cn(
        'tap-44 flex justify-center items-center size-4 rounded-full transition-colors cursor-pointer',
        className,
      )}
      {...props}
    >
      <CrossIcon className="text-ink h-4 w-4" />
      <span className="sr-only">Close</span>
      <RippleLayer ripples={ripples} onClear={clear} />
    </DialogPrimitive.Close>
  );
};
DrawerCloseButton.displayName = 'DrawerCloseButton';

// Every BSC drawer scrolls through ScrollArea, so they all get the persistent
// custom thumb (native scrollbar CSS can't be styled consistently — Safari
// ignores it in overlay mode). outerClassName owns the flex-grow; the inner
// scroll div owns the padding.
const DrawerBody = ({ className, children }: { className?: string; children: React.ReactNode }) => (
  <ScrollArea
    outerClassName="min-h-0 flex-1"
    className={cn(
      // Mobile + tablet: padding 0px 16px 16px
      'px-4 pb-4',
      // Desktop (lg+): padding 0px 40px 40px
      'lg:px-10 lg:pb-10',
      className,
    )}
  >
    {children}
  </ScrollArea>
);
DrawerBody.displayName = 'DrawerBody';

// ── BSC drawers ────────────────────────────────────────────────────────────
// Shell + footer for BSC's drawers (size, added-to-bag, edit-size). All the
// chrome — mobile bottom sheet capped at 524px, desktop right panel, header
// typography, sticky-footer CTA styling — lives here so a drawer only passes
// its title, body, and footer CTA text. The body (DrawerBody) is the children.

const SHELL_TITLE_CLASS =
  'text-left font-normal leading-none text-ink fl-m-text-[16] tracking-[0.02em] lg:text-[20px] lg:tracking-[0.01em]';

interface DrawerShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  contentClassName?: string; // override width/height etc., e.g. "lg:w-[488px] max-h-[80dvh]"
  contentStyle?: React.CSSProperties; // e.g. a locked-viewport-height CSS var alongside contentClassName
  children: React.ReactNode;
}

const DrawerShell = ({
  open,
  onClose,
  title,
  contentClassName,
  contentStyle,
  children,
}: DrawerShellProps) => {
  // Explicit lock tied to the real open state — a backstop alongside Radix's own scroll lock,
  // since nested scroll areas (ScrollArea) can let touch/wheel scroll-chaining escape its shard.
  useBodyScrollLock(open);

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DrawerContent
        className={cn('max-h-[524px] md:max-h-full', contentClassName)}
        style={contentStyle}
      >
        <DrawerHeader className="fl-m-h-[44] border-b divider lg:h-[62px] lg:px-6 lg:py-0">
          <DrawerTitle className={SHELL_TITLE_CLASS}>{title}</DrawerTitle>
          <DrawerCloseButton />
        </DrawerHeader>
        {children}
      </DrawerContent>
    </Drawer>
  );
};
DrawerShell.displayName = 'DrawerShell';

interface DrawerCtaFooterProps {
  label: string;
  onClick?: () => void;
  href?: string; // navigation CTA (renders an Alink, e.g. "View Bag" → /cart)
  disabled?: boolean;
  loading?: boolean;
  mobileOnly?: boolean; // hide on desktop (the CTA lives elsewhere there, e.g. in-row View Bag)
  wishlist?: React.ReactNode; // optional element beside the CTA (e.g. <WishlistButton/>)
  fixFooterNav?: boolean; // override --spacing-bottom-nav when this CTA is taller than the global bottom nav
}

/** Sticky CTA footer for BSC drawers — pass the button text + (optionally) a wishlist node. */
const DrawerCtaFooter = ({
  label,
  onClick,
  href,
  disabled,
  loading,
  mobileOnly,
  wishlist,
  fixFooterNav,
}: DrawerCtaFooterProps) => {
  // This CTA is 84px — larger than the global bottom nav (52px). Override the shared
  // token so the footer's existing padding calc gives the correct clearance.
  React.useEffect(() => {
    if (!fixFooterNav) return;
    document.documentElement.style.setProperty('--spacing-bottom-nav', '84px');
    return () => {
      document.documentElement.style.removeProperty('--spacing-bottom-nav');
    };
  }, [fixFooterNav]);

  return (
    <DrawerFooter
      className={cn(
        // 16px+inset matches the base DrawerFooter and the PDP CTA bar — 32px left dead space below the CTA.
        'gap-3 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))] lg:px-6 lg:py-4',
        mobileOnly && 'lg:hidden',
      )}
    >
      {href ? (
        <Alink
          href={href}
          onClick={onClick}
          className="flex h-10 flex-1 items-center justify-center rounded-full bg-ink uppercase text-[12px] leading-none tracking-[0.03em] lg:tracking-[0.02em] text-white transition-opacity hover:opacity-90 lg:h-12 lg:text-[14px]"
        >
          {label}
        </Alink>
      ) : (
        <Button
          variant="solid"
          disabled={disabled}
          loading={loading}
          onClick={onClick}
          className="h-10 flex-1 lg:h-12"
        >
          {label}
        </Button>
      )}
      {wishlist}
    </DrawerFooter>
  );
};
DrawerCtaFooter.displayName = 'DrawerCtaFooter';

/** The BSC drawer kit — the only three pieces a BSC drawer needs: Shell (chrome),
 *  Body (scroll area), Footer (sticky CTA). One import covers all three. */
const BscDrawer = {
  Shell: DrawerShell,
  Body: DrawerBody,
  Footer: DrawerCtaFooter,
};

export {
  BscDrawer,
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerCloseButton,
  DrawerContent,
  DrawerCtaFooter,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerShell,
  DrawerTitle,
  DrawerTrigger,
};
