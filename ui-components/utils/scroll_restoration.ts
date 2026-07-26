// Per-URL scroll-position persistence for browser back/forward navigation.
//
// The flow, end to end:
//   1. SAVE     — record the scroll offset against the current URL, on three triggers (see
//                 initScrollRestoration): user scrolling, real page unload, and any
//                 click (the only one that catches an in-app SPA navigation). The offset
//                 comes from currentScrollY(), not window.scrollY — see why there.
//   2. RESTORE  — on popstate, read that URL's saved position and scroll to it,
//                 re-asserting across frames until the page settles (restoreForCurrentUrl).
//   3. PUBLISH  — while a restore runs, expose its target via getActiveRestoreTarget()
//                 so page chrome (header, bottom nav, progressive block loader) can read
//                 where we're GOING instead of the scrollY that's still catching up.
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

/** sessionStorage key for the URL being viewed right now — path + query, so `?page=2`
 *  and `?page=3` each remember their own position. */
const urlKey = () => `${PREFIX}${window.location.pathname}${window.location.search}`;

let initialized = false;

// Set for the duration of an active restoreForCurrentUrl() run (cleared in its own
// stop()) so a component whose first render happens to land mid-restore — e.g. the
// header deciding transparent vs solid — can read the TARGET it's being restored to
// instead of the real (still catching-up) window.scrollY, which lags behind by
// however many frames the re-assertion loop needs.
let activeRestoreTarget: number | null = null;

// The in-flight loop's own teardown. Two popstates in quick succession would otherwise
// leave both loops running — each scrollTo()-ing a different target — and whichever
// stopped first would null the shared target while the other was still going.
let cancelActiveRestore: (() => void) | null = null;

/** The position a back/forward restore is currently re-asserting toward, or null when
 *  no restore is in flight (including a plain forward navigation with nothing to restore). */
export function getActiveRestoreTarget(): number | null {
  return activeRestoreTarget;
}

/** Where the page really is — `window.scrollY` lies while a drawer is open.
 *
 *  useBodyScrollLock pins the body with `position: fixed`, so the document isn't scrolled at all
 *  and `window.scrollY` reads 0 no matter where the user was. It parks the real offset on `<html>`
 *  first, so read that instead: without it, opening the hamburger at 1500 saves 0 and every later
 *  back-nav to that page lands at the top. */
function currentScrollY(): number {
  const locked = document.documentElement.dataset.scrollLockY;
  if (locked !== undefined) {
    const parsed = Number(locked);
    if (Number.isFinite(parsed)) return parsed;
  }
  return window.scrollY;
}

/** Persist the window's current scroll position for the active URL. */
function saveScrollPosition(): void {
  // Never save mid-restore. Each of the restore loop's ~90 scrollTo() calls fires a scroll event
  // that lands here, but the page may still be too short to reach the target, so what we'd save is
  // a clamped half-way value — overwriting the correct position we're restoring TO.
  if (activeRestoreTarget !== null) return;
  try {
    sessionStorage.setItem(urlKey(), String(currentScrollY()));
  } catch {
    // Private mode / quota — scroll restore is best-effort, never block nav.
  }
}

/** Reads back this URL's saved position — null when there's nothing stored or it's unusable. */
function readScrollPosition(): number | null {
  try {
    const value = sessionStorage.getItem(urlKey());
    if (value === null) return null;
    // Guard the parse. A corrupt entry yields NaN, which is not null so it would sail through
    // the caller's check and reach every getActiveRestoreTarget() consumer — where `NaN > x` is
    // always false, so the header would decide it's at the top of the page.
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Scrolls this URL back to its saved position (the popstate handler).
 *
 *  Re-asserts the target once per frame rather than scrolling once, for two reasons: the
 *  router can issue its own scroll-to-top just after us, and a progressively-rendered page
 *  may still be too short to reach the target on the first try. Bails the moment the user
 *  scrolls, types, or clicks — whatever they just did outranks where they used to be. */
function restoreForCurrentUrl(): void {
  // Kill any loop from an earlier popstate FIRST — before the early return below, not after.
  // Fast back/forward into a URL with nothing saved used to return before reaching this, so the
  // previous loop stayed alive and kept scrolling the OLD page's offset onto the new one.
  cancelActiveRestore?.();

  const target = readScrollPosition();
  // Nothing saved is the ONLY no-op. A saved 0 still has to be scrolled to like any other
  // position: this is one document, so on Back the window is still sitting at the offset of the
  // page we just left, and `scrollRestoration = 'manual'` means nobody resets it but us.
  if (target === null) return;

  activeRestoreTarget = target;
  let frame = 0;
  let ticks = 0;
  // Ends this run: kill the pending frame, unhook the bail listeners, release shared state.
  const stop = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('wheel', stop);
    window.removeEventListener('touchmove', stop);
    window.removeEventListener('keydown', stop);
    document.removeEventListener('click', stop, true);
    // Only clear the shared state if a newer restore hasn't already taken it over.
    if (cancelActiveRestore === stop) {
      cancelActiveRestore = null;
      activeRestoreTarget = null;
    }
  };
  cancelActiveRestore = stop;
  // One re-assertion per frame until the budget runs out (or a bail listener fires).
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
  // Bail listeners — any real user intent cancels the rest of the loop.
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

/** Wires up the three save triggers + the restore handler. Idempotent; browser-only.
 *  Called once from the ScrollRestoration provider. */
export function initScrollRestoration(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  // Own scroll restoration so the browser doesn't fight our manual restore.
  window.history.scrollRestoration = 'manual';

  // SAVE 1 — while the user scrolls. rAF-debounced so a scroll burst writes once per frame.
  let saveFrame = 0;
  window.addEventListener(
    'scroll',
    () => {
      cancelAnimationFrame(saveFrame);
      saveFrame = requestAnimationFrame(saveScrollPosition);
    },
    { passive: true },
  );
  // SAVE 2 — real document unload: tab close, hard refresh, navigation off-site.
  window.addEventListener('pagehide', saveScrollPosition);
  // SAVE 3 — in-app navigation. A client-side route change (Link click) never fires
  // `pagehide` — the document never unloads, App Router just swaps content — so without
  // this, a URL that's revisited briefly and left without ever firing a native `scroll`
  // event keeps whatever position was saved on some EARLIER, unrelated visit, and a later
  // back-nav restores that stale value instead of where THIS visit left off.
  document.addEventListener('click', saveScrollPosition, true);

  // RESTORE — back/forward only; a forward navigation should open wherever it opens.
  window.addEventListener('popstate', restoreForCurrentUrl);
}
