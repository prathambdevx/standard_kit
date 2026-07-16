'use client';

import { useCallback, useRef, useState } from 'react';

interface RippleInstance {
  id: number;
  x: number;
  y: number;
  size: number;
}

/**
 * Material-style click ripple for any element (Button, Alink, Radix Close, raw
 * button). Call `onPointerDown` on the host and render <RippleLayer> inside it.
 * The host must be `relative` and rounded — the layer clips to the host radius,
 * so a square host produces a squarish ripple (add `rounded-full` for icon hits).
 */
export const useRipple = (enabled = true) => {
  const [ripples, setRipples] = useState<RippleInstance[]>([]);
  const nextId = useRef(0);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!enabled) return;
      // Seed the ripple at the pointer; size to twice the longest edge so it
      // always reaches the far corner regardless of where the click landed.
      const rect = event.currentTarget.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2;
      setRipples((prev) => [
        ...prev,
        {
          id: nextId.current++,
          x: event.clientX - rect.left - size / 2,
          y: event.clientY - rect.top - size / 2,
          size,
        },
      ]);
    },
    [enabled],
  );

  const clear = useCallback((id: number) => {
    setRipples((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return { ripples, onPointerDown, clear };
};

/**
 * Clipped overlay that paints the active ripples. `rounded` sets the clip shape —
 * defaults to the host radius; pass `rounded-full` to guarantee a round (never
 * squarish) ripple on icon-sized hits. `spread` grows the clip region past the
 * host on every side so a tiny icon button's ripple stays visible instead of
 * being clipped to its small footprint.
 */
export const RippleLayer = ({
  ripples,
  onClear,
  rounded = 'rounded-[inherit]',
  spread = 0,
}: {
  ripples: RippleInstance[];
  onClear: (id: number) => void;
  rounded?: string;
  /** Pixels the clip region extends beyond the host on each side (icon buttons). */
  spread?: number;
}) => {
  if (ripples.length === 0) return null;
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute overflow-hidden ${rounded}`}
      // Runtime spread — a negative inset can't be a static utility class.
      style={{ inset: -spread }}
    >
      {ripples.map((r) => (
        <span
          key={r.id}
          onAnimationEnd={() => onClear(r.id)}
          // Runtime pointer coordinates — offset by `spread` so the ripple stays
          // centred on the pointer now that the clip origin shifted out by `spread`.
          className="absolute rounded-full bg-current animate-ripple"
          style={{ left: r.x + spread, top: r.y + spread, width: r.size, height: r.size }}
        />
      ))}
    </span>
  );
};
