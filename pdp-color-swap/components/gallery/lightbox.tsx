'use client';

import { useEffect, useRef, useState } from 'react';

import { ChevronMiniLeftIcon } from '@/assets/icons/chevron_mini_left_icon';
import { ChevronMiniRightIcon } from '@/assets/icons/chevron_mini_right_icon';
import { CloseIcon } from '@/assets/icons/close_icon';
import { Button } from '@/components/ui/button';
import { Img } from '@/components/ui/img';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { track } from '@/lib/analytics';
import type { GalleryImage } from '@/types/components/pdp/gallery';

export type LightboxState = {
  src: string;
  alt: string;
  index: number;
};

export const Lightbox = ({
  images,
  activeImage,
  productName,
  onClose,
  onNavigate,
}: {
  images: GalleryImage[];
  activeImage: LightboxState;
  productName: string;
  onClose: () => void;
  onNavigate: (img: GalleryImage, index: number) => void;
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const closingRef = useRef(false);

  // Pinch-to-zoom (mobile)
  const [imgScale, setImgScale] = useState(1);
  const [imgTranslate, setImgTranslate] = useState({ x: 0, y: 0 });
  const pinchStartDistRef = useRef(0);
  const pinchStartScaleRef = useRef(1);
  const panStartRef = useRef({ x: 0, y: 0 });
  const translateAtPanStartRef = useRef({ x: 0, y: 0 });
  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);
  const imgContainerRef = useRef<HTMLDivElement>(null);
  const thumbnailsRef = useRef<HTMLDivElement>(null);

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setIsVisible(false);
    setTimeout(onClose, 250);
  };

  const navigate = (dir: 'prev' | 'next') => {
    const total = images.length;
    const next =
      dir === 'prev' ? (activeImage.index - 1 + total) % total : (activeImage.index + 1) % total;
    const img = images[next];
    if (img) onNavigate(img, next);
  };

  // Arrow-button navigation is the tracked interaction — keyboard/swipe fire their own events
  const handleArrow = (dir: 'prev' | 'next') => {
    track.pdp.arrow(dir === 'prev' ? 'left_arrow' : 'right_arrow', {
      sectionName: 'Image Gallery',
      productName,
    });
    navigate(dir);
  };

  const handleClose = () => {
    track.pdp.arrow('close', { sectionName: 'Image Gallery', productName });
    close();
  };

  // Keep stable refs so keyboard handler never goes stale
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const id = requestAnimationFrame(() => setIsVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useBodyScrollLock(true);

  // Keyboard — ArrowLeft / ArrowRight / Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') navigateRef.current('prev');
      else if (e.key === 'ArrowRight') navigateRef.current('next');
      else if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Non-passive touchmove so pinch can preventDefault (stops browser page-zoom)
  useEffect(() => {
    const el = imgContainerRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => {
      if (e.touches.length >= 2) e.preventDefault();
    };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, []);

  // Reset zoom whenever the active image changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset zoom only when active image changes
  useEffect(() => {
    setImgScale(1);
    setImgTranslate({ x: 0, y: 0 });
  }, [activeImage.index]);

  // Keep the active thumbnail visible in the strip
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run when the active index changes
  useEffect(() => {
    thumbnailsRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [activeImage.index]);

  const getTouchDist = (t1: React.Touch, t2: React.Touch) => {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    const t0 = e.touches[0];
    const t1 = e.touches[1];
    if (e.touches.length === 2 && t0 && t1) {
      pinchStartDistRef.current = getTouchDist(t0, t1);
      pinchStartScaleRef.current = imgScale;
    } else if (t0) {
      touchStartXRef.current = t0.clientX;
      touchStartYRef.current = t0.clientY;
      panStartRef.current = { x: t0.clientX, y: t0.clientY };
      translateAtPanStartRef.current = imgTranslate;
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const t0 = e.touches[0];
    const t1 = e.touches[1];
    if (e.touches.length === 2 && t0 && t1) {
      const dist = getTouchDist(t0, t1);
      setImgScale(
        Math.max(1, Math.min(4, pinchStartScaleRef.current * (dist / pinchStartDistRef.current))),
      );
    } else if (e.touches.length === 1 && t0 && imgScale > 1.05) {
      setImgTranslate({
        x: translateAtPanStartRef.current.x + (t0.clientX - panStartRef.current.x),
        y: translateAtPanStartRef.current.y + (t0.clientY - panStartRef.current.y),
      });
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const ct = e.changedTouches[0];
    if (e.touches.length === 0 && ct) {
      const dx = ct.clientX - touchStartXRef.current;
      const dy = ct.clientY - touchStartYRef.current;
      // Horizontal swipe only when not zoomed
      if (imgScale <= 1.05 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        navigate(dx < 0 ? 'next' : 'prev');
      }
      if (imgScale < 1) {
        setImgScale(1);
        setImgTranslate({ x: 0, y: 0 });
      }
    }
  };

  const hasMultiple = images.length > 1;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-md transition-opacity duration-300 ease-in-out"
      style={{ opacity: isVisible ? 1 : 0 }}
      role="dialog"
      aria-modal="true"
    >
      {/* Preload non-active images */}
      {images.map((img) =>
        img.src === activeImage.src ? null : (
          <Img
            key={img.src}
            src={img.src}
            alt=""
            width={900}
            height={1100}
            sizes="100vw"
            className="invisible absolute size-0"
            aria-hidden="true"
          />
        ),
      )}

      {/* ── MOBILE ── */}
      <div className="flex h-full flex-col justify-center lg:hidden">
        {/* Image + side arrows — container sized to match actual rendered image so arrows stay inside */}
        <div className="flex w-full justify-center">
          <div
            ref={imgContainerRef}
            className="relative w-full overflow-hidden"
            // svh (not dvh) so the fullscreen image never resizes/overflows as the iOS URL bar toggles.
            style={{ maxHeight: 'calc(100svh - 150px)' }}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            <div
              className="w-full"
              style={{
                transform: `scale(${imgScale}) translate(${imgTranslate.x / imgScale}px, ${imgTranslate.y / imgScale}px)`,
                transformOrigin: 'center center',
                transition: imgScale === 1 ? 'transform 200ms ease' : undefined,
              }}
            >
              <Img
                src={activeImage.src}
                alt={activeImage.alt}
                width={900}
                height={1100}
                sizes="100vw"
                className="w-full object-contain"
                style={{ maxHeight: 'calc(100svh - 150px)' }}
              />
            </div>

            {/* Close — top-right, white icon on dark pill for visibility on any background */}
            <Button
              variant="none"
              ripple
              aria-label="Close"
              onClick={handleClose}
              className="absolute fl-m-right-[12] fl-m-top-[12] flex fl-m-size-[28] items-center justify-center
                rounded-full bg-black/50 text-white hover:bg-black/70"
            >
              <CloseIcon className="fl-m-size-[10]" />
            </Button>
          </div>
        </div>

        {/* Thumbnail strip */}
        <div
          ref={thumbnailsRef}
          className="flex shrink-0 justify-center fl-m-gap-[6] fl-m-px-[8] fl-m-py-[12]"
        >
          {images.map((img, i) => (
            <Button
              key={img.src}
              variant="none"
              data-active={i === activeImage.index}
              onClick={() => onNavigate(img, i)}
              aria-label={`Image ${i + 1}`}
              className={`aspect-[3/4] min-w-0 flex-1 fl-m-max-w-[56] overflow-hidden rounded transition-all ${
                i === activeImage.index
                  ? 'ring-2 ring-white ring-offset-1 ring-offset-black'
                  : 'opacity-40 hover:opacity-70'
              }`}
            >
              <Img
                src={img.src}
                alt=""
                width={96}
                height={128}
                sizes="48px"
                className="h-full w-full object-cover"
              />
            </Button>
          ))}
        </div>
      </div>

      {/* ── DESKTOP ── */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss on click, keyboard handled via useEffect */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard Escape handled in the global keydown listener */}
      <div
        className="relative hidden h-full cursor-default items-center justify-center lg:flex"
        onClick={close}
      >
        {/* Thumbnails + image sit in one centered row so thumbnails hug the image */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: stops backdrop dismiss from firing when clicking content */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled by global keydown listener */}
        <div
          className="flex h-full max-w-[min(90vw,1200px)] items-start fl-gap-[12,12] fl-p-[16,16]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Vertical thumbnail strip */}
          <div
            className="flex fl-w-[56,56] shrink-0 flex-col fl-gap-[6,6] overflow-y-auto
            [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {images.map((img, i) => (
              <Button
                key={img.src}
                variant="none"
                data-active={i === activeImage.index}
                onClick={() => onNavigate(img, i)}
                aria-label={`Image ${i + 1}`}
                className={`aspect-[3/4] w-full shrink-0 overflow-hidden rounded transition-all ${
                  i === activeImage.index ? '' : 'opacity-40 hover:opacity-70'
                }`}
              >
                <Img
                  src={img.src}
                  alt=""
                  width={56}
                  height={75}
                  sizes="56px"
                  className="h-full w-full object-cover"
                />
              </Button>
            ))}
          </div>

          {/* Main image + side arrows + close */}
          <div className="relative flex h-full flex-1 items-start justify-center">
            <Img
              src={activeImage.src}
              alt={activeImage.alt}
              width={900}
              height={1100}
              sizes="75vw"
              className="max-h-full max-w-full object-contain"
            />

            {hasMultiple && (
              <>
                <Button
                  variant="none"
                  ripple
                  aria-label="Previous image"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleArrow('prev');
                  }}
                  className="absolute fl-left-[16,16] top-1/2 -translate-y-1/2 flex fl-size-[40,40] items-center
                    justify-center rounded border border-white/30 bg-black/20 text-white hover:bg-black/40 rounded-full"
                >
                  <ChevronMiniLeftIcon className="fl-size-[14,14]" />
                </Button>
                <Button
                  variant="none"
                  ripple
                  aria-label="Next image"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleArrow('next');
                  }}
                  className="absolute fl-right-[16,16] top-1/2 -translate-y-1/2 flex fl-size-[40,40] items-center
                    justify-center rounded-full border border-white/30 bg-black/20 text-white hover:bg-black/40"
                >
                  <ChevronMiniRightIcon className="fl-size-[14,14]" />
                </Button>
              </>
            )}

            <Button
              variant="none"
              ripple
              aria-label="Close"
              onClick={(e) => {
                e.stopPropagation();
                handleClose();
              }}
              className="absolute fl-right-[16,16] fl-top-[24,24] flex fl-size-[40,40] items-center justify-center
                rounded-full bg-black/50 text-white hover:bg-black/70"
            >
              <CloseIcon className="fl-size-[14,14]" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
