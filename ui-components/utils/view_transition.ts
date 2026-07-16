import { flushSync } from 'react-dom';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

type ViewTransitionDoc = Document & {
  startViewTransition?: (cb: () => unknown) => unknown;
};

/**
 * Animate a synchronous, same-page React state change (e.g. the PDP colour
 * swap) with the browser View Transitions API. `flushSync` commits the update
 * inside the transition so the browser snapshots the new layout and crossfades
 * to it. Falls back to an instant update when unsupported or reduced-motion is
 * on. The browser provides a default root crossfade — no extra CSS needed.
 */
export function startStateTransition(update: () => void): void {
  const doc = document as ViewTransitionDoc;
  if (typeof doc.startViewTransition !== 'function' || prefersReducedMotion()) {
    update();
    return;
  }
  doc.startViewTransition(() => flushSync(update));
}

/**
 * Crossfade a route navigation (e.g. `() => router.push(href)`). The new route
 * streams in asynchronously, so the transition is held briefly to let it paint,
 * bounded so it can never hang. Falls back to an instant navigation when the
 * API is unavailable or the user prefers reduced motion.
 */
export function startRouteTransition(navigate: () => void): void {
  const doc = document as ViewTransitionDoc;
  if (typeof doc.startViewTransition !== 'function' || prefersReducedMotion()) {
    navigate();
    return;
  }
  doc.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        navigate();
        // Give the new route a brief window to render before the crossfade runs.
        setTimeout(resolve, 250);
      }),
  );
}
