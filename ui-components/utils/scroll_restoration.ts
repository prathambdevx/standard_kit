// Per-URL scroll-position persistence for browser back/forward navigation.
//
// Everything lives at module scope and is wired up once, because the app shell
// (and the ScrollRestoration component) unmounts/remounts whenever a page
// suspends — a component-local listener or ref would miss the signal.
//
// Restore is driven straight from the `popstate` handler rather than a React
// effect: App Router re-renders the new route *before* the native popstate
// listener runs, so an effect reading a "was this a pop?" flag always sees it
// too early. By popstate time `window.location` is already the destination, so
// we read its saved position and re-assert it across frames as the (possibly
// progressively-rendered) page settles.

const PREFIX = 'scroll:';

const urlKey = () => `${PREFIX}${window.location.pathname}${window.location.search}`;

let initialized = false;

/** Persist the window's current scroll position for the active URL. */
export function saveScrollPosition(): void {
  try {
    sessionStorage.setItem(urlKey(), String(window.scrollY));
  } catch {
    // Private mode / quota — scroll restore is best-effort, never block nav.
  }
}

function readScrollPosition(): number | null {
  try {
    const value = sessionStorage.getItem(urlKey());
    return value === null ? null : Number(value);
  } catch {
    return null;
  }
}

// Re-assert the target across frames so a late router scroll-to-top can't win
// and so the target is still reached as a lazily-rendered page grows tall
// enough — bail the moment the user scrolls themselves.
function restoreForCurrentUrl(): void {
  const target = readScrollPosition();
  if (target === null || target === 0) return;

  let frame = 0;
  let ticks = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('wheel', stop);
    window.removeEventListener('touchmove', stop);
    window.removeEventListener('keydown', stop);
    document.removeEventListener('click', stop, true);
  };
  const tick = () => {
    window.scrollTo(0, target);
    // ~90 frames (≈1.5s) covers a late scroll reset and progressive content.
    if (ticks < 90) {
      ticks += 1;
      frame = requestAnimationFrame(tick);
    } else {
      stop();
    }
  };
  window.addEventListener('wheel', stop, { passive: true });
  window.addEventListener('touchmove', stop, { passive: true });
  window.addEventListener('keydown', stop);
  // A click (e.g. a nav link to a fresh page) means the user is leaving this URL —
  // without this, the re-assertion loop keeps calling scrollTo() into whatever page
  // loads next for up to 1.5s, dragging a freshly-opened collection back down to the
  // old scroll position instead of letting it open at the top.
  document.addEventListener('click', stop, true);
  frame = requestAnimationFrame(tick);
}

/** Wire up scroll saving + back/forward restore. Idempotent; browser-only. */
export function initScrollRestoration(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  // Own scroll restoration so the browser doesn't fight our manual restore.
  window.history.scrollRestoration = 'manual';

  let saveFrame = 0;
  window.addEventListener(
    'scroll',
    () => {
      cancelAnimationFrame(saveFrame);
      saveFrame = requestAnimationFrame(saveScrollPosition);
    },
    { passive: true },
  );
  window.addEventListener('pagehide', saveScrollPosition);
  window.addEventListener('popstate', restoreForCurrentUrl);
}
