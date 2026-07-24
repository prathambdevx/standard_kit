'use client';

import { useCallback, useRef } from 'react';

// Not currently used anywhere — import and pass the returned ref to any scrollable element to enable mouse drag-to-scroll.

/**
 * Mouse drag-to-scroll for a native snap rail. Deliberately does NOT
 * touch the wheel: vertical wheel keeps scrolling the PAGE (the old
 * deltaY->scrollLeft conversion trapped page scrolling over rails) and
 * horizontal trackpad pan drives the rail natively.
 *
 * Drag details, each fixing a past glitch:
 * - `dragstart` blocked — grabbing a product image starts an OS image
 *   drag and fires pointercancel ~25px in, killing the gesture.
 * - 5px engage threshold — plain clicks never disturb scroll-snap or
 *   flash the grab cursor.
 * - Lazy pointer capture (only once dragging) — capture on pointerdown
 *   would retarget clicks away from the card links.
 * - Consumed-flag click swallow — releasing a drag over a card must
 *   not open its product page.
 * - Direct scrollLeft writes + snap re-enabled next frame on release —
 *   1:1 tracking, then CSS snap-proximity settles to the nearest card.
 * Touch is untouched: native scrolling already does the right thing.
 */
export const useHorizontalScroll = <T extends HTMLElement>() => {
  const cleanupRef = useRef<(() => void) | null>(null);

  const ref = useCallback((node: T | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;

    if (!node) return;

    const DRAG_THRESHOLD = 5;
    let pointerDown = false;
    let dragging = false;
    let didDrag = false;
    let dragStartX = 0;
    let dragStartScroll = 0;
    let snapDisabled = false;

    const blockNativeDrag = (e: Event) => e.preventDefault();

    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      pointerDown = true;
      dragging = false;
      dragStartX = e.clientX;
      dragStartScroll = node.scrollLeft;
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!pointerDown) return;
      const dx = e.clientX - dragStartX;
      if (!dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD) return;
        dragging = true;
        didDrag = true;
        try {
          node.setPointerCapture(e.pointerId);
        } catch {
          // pointer already gone — tracking continues via move events
        }
        node.style.cursor = 'grabbing';
        node.style.userSelect = 'none';
        node.style.scrollSnapType = 'none';
        snapDisabled = true;
      }
      node.scrollLeft = dragStartScroll - dx;
    };

    const handlePointerUp = () => {
      pointerDown = false;
      if (!dragging) return;
      dragging = false;
      node.style.cursor = '';
      node.style.userSelect = '';
      if (snapDisabled) {
        // next frame so the browser settles to the nearest snap point
        // without fighting the last scroll write
        requestAnimationFrame(() => {
          node.style.scrollSnapType = '';
          snapDisabled = false;
        });
      }
    };

    const swallowClickAfterDrag = (e: MouseEvent) => {
      if (!didDrag) return;
      didDrag = false;
      e.preventDefault();
      e.stopPropagation();
    };

    node.addEventListener('dragstart', blockNativeDrag);
    node.addEventListener('pointerdown', handlePointerDown);
    node.addEventListener('pointermove', handlePointerMove);
    node.addEventListener('pointerup', handlePointerUp);
    node.addEventListener('pointercancel', handlePointerUp);
    node.addEventListener('click', swallowClickAfterDrag, true);

    cleanupRef.current = () => {
      node.removeEventListener('dragstart', blockNativeDrag);
      node.removeEventListener('pointerdown', handlePointerDown);
      node.removeEventListener('pointermove', handlePointerMove);
      node.removeEventListener('pointerup', handlePointerUp);
      node.removeEventListener('pointercancel', handlePointerUp);
      node.removeEventListener('click', swallowClickAfterDrag, true);
      if (snapDisabled) node.style.scrollSnapType = '';
    };
  }, []);

  return ref;
};
