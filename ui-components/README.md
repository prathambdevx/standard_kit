# ui-components — atom library + carousel + star-fill math

A set of production UI atoms (Radix-based where interaction/a11y is non-trivial, plain otherwise),
an embla-powered carousel, TanStack Query wrapper hooks + provider, and a genuinely reusable bit of
math (area-accurate star-rating fill). Pulled from a real Next.js 15 + Tailwind v4 app — copy in,
wire the import alias, done.

Everything here is meant to be dropped in as-is, no per-project judgment call required. A few
things that don't fit that bar (a decorative parallax effect, Lenis-powered smooth scroll, a
desktop-only mouse-wheel enhancement) live in the sibling **`extras/`** kit instead — optional,
copy in only if a project specifically wants that one thing.

## The core atom rule

**Never reach for a raw HTML primitive when one of these exists — always the atom.**

| Atom | Replaces |
|------|----------|
| `<Button>` from `@/components/ui/button` | raw `<button>` |
| `<Img>` from `@/components/ui/img` | `next/image` |
| `<Picture>` from `@/components/ui/picture` | `<picture>` + `next/image` |
| `<Alink>` from `@/components/ui/alink` | `next/link` / `<a>` |

If a needed atom doesn't exist yet, create it in `components/ui/` first — never inline a one-off
workaround (a raw `<button className="...">`, a bare `<a>`, a hand-rolled `<img>`).

## What's in here

### `components/` — drop into `src/components/ui/`

| File | What it is |
|---|---|
| `button.tsx` | The `<Button>` atom — variant system (`solid`/`outline`/`white`/`ghost`/`none`), loading state, optional ripple |
| `img.tsx` | `<Img>` — `next/image` wrapper: custom CDN loader (2x DPR; `width=`/`quality=` for Shopify, `w=`/`q=` elsewhere — Shopify's CDN silently ignores `q=`), `showLoader` spinner-gated lazy load, graceful fallback box on missing/failed `src` (never the browser's broken-image icon) |
| `image_preload.tsx` | `warmImageCache(src, renderWidth)` + `<ImagePreload items skipSrc sizes />` — cache-warms the exact URL `<Img>` will fetch later (hover-intent warm, or an invisible mount for every item except the one currently shown), so a swap to a bigger/different size lands on an already-cached image instead of a fresh fetch. See below. |
| `picture.tsx` | `<Picture>` — separate mobile/desktop image sources with `preload()` for the LCP candidate |
| `alink.tsx` | `<Alink>` — `next/link` wrapper with hover/CTA styling + analytics hooks (see Adapt below) |
| `accordion.tsx` | Radix accordion wrapper (single/multiple, animated open/close) |
| `drawer.tsx` | Radix dialog-based bottom-sheet/side-panel shell — header/body/footer slots, body-scroll-lock, ripple close button |
| `field_error.tsx` | Small inline form-error message atom |
| `media.tsx` | Polymorphic image-or-video renderer (checks `isVideoUrl`, renders `<Img>` or `<Vid>` accordingly) |
| `select.tsx` | Radix select wrapper |
| `date_picker.tsx` | Radix popover + `react-day-picker` calendar — single-date select, min/max disabled-range, custom chevron icons, YYYY-MM-DD in/out with local-timezone-safe parsing (no UTC-shift-by-one-day bugs) |
| `video.tsx` | Custom video player — play/pause/mute controls, custom icons |
| `hover_zoom_image.tsx` | Wraps an `Img`/`Picture` to scale up slightly on hover (pairs with a `group` class on the parent) |
| `star_rating.tsx` | Interactive star picker (hover preview, controlled value) |
| `carousel.tsx` + `carousel_dots.tsx` | Embla-powered carousel (loop, autoplay, drag) + a paired dot-indicator strip |
| `edge_scroll/index.tsx` | Scroll-snap row wrapper (native overflow-scroll + touch, NOT embla) for card rails — works standalone; `extras/hooks/useHorizontalScroll.ts` is an optional bolt-on for plain desktop mouse-wheel support, not wired in by default |
| `ripple.tsx`, `scroll_area.tsx`, `loading_spinner.tsx` | Small shared primitives several atoms above depend on |

### `image_preload.tsx` — cache-warming for swappable image views

Two independent exports, both depending only on `<Img>`:

- **`warmImageCache(src, renderWidth, quality?)`** — a plain function, no JSX. Fires
  `new Image().src = ...` at the exact URL `<Img>`'s loader would request for that
  `renderWidth` (same 2x-DPR/2560-cap math as `img.tsx`). Call it from `onMouseEnter`
  on anything that's about to swap to a bigger version of an image already on the
  page — a thumbnail hovered before opening a lightbox, a card hovered before its
  detail view. Only needs `src` + the render width; height plays no part in the
  fetch URL.
- **`<ImagePreload items skipSrc sizes />`** — mounts an invisible (`size-0`) `<Img>`
  for every item except `skipSrc`, at each `{width, height}` in `sizes`. Built for a
  swappable single-image view — a carousel/lightbox/color-swap hero driven by one
  "current" index, where only one image is ever actually mounted at a time. Mount it
  anywhere in the tree; it renders nothing visible, it just triggers the fetches so
  switching `current` later is a cache hit instead of a fresh request.

Both are CDN-URL-scheme aware (Shopify's `?width=&quality=` vs a generic `?w=&q=` —
Shopify's CDN silently ignores `q=`, `quality=` is the real param, same as `img.tsx`'s
own loader) — if your project's image loader builds URLs differently, update that
branch in `warmImageCache` to match, since the preload/warm URL and the real fetch
URL must be byte-identical for the cache hit to actually land.

### `icons/` — drop into `src/assets/icons/`

One SVG-wrapper-per-file convention (`aria-hidden`, `currentColor` fill/stroke). Includes the icons
`video.tsx`/`select.tsx`/`drawer.tsx` reference, plus **`star_icon.tsx`** — see below, it's the one
with the math.

### `hooks/` — drop into `src/hooks/`

| File | What it is |
|---|---|
| `useBodyScrollLock.ts` | Locks page scroll while a drawer/modal is open — pins `<body>` with `position: fixed` (not `overflow: hidden`, a no-op for iOS touch-drag), ref-counted so overlapping locks don't fight each other. **Side effect to know: while locked, `window.scrollY` reads 0** — it stashes the true offset on `<html>` as `data-scroll-lock-y`, and anything reading scroll position must prefer that (see scroll_restoration note 7) |
| `useLockedViewportHeight.ts` | Sizes a full-screen mobile overlay to the real visible viewport (`visualViewport.offsetTop + height`, re-settled on resize *and* visualViewport scroll) so it neither gaps on Android, nor jitters/gets cut off on iOS, nor — with the keyboard open — exposes the page behind it or stops its own panel scrolling. Both terms are load-bearing; see the `ios-safari-fixes` kit's rule 8 for why each one is there and its scope boundaries |
| `useApiQuery.ts` + `useApiMutation.ts` | Thin TanStack Query wrappers over sensible app-wide defaults (`staleTime`, `gcTime`, retry, optimistic cache patch) — pair with `providers/QueryProvider.tsx` |
| `useDebouncedValue.ts` | Returns a copy of a value that only updates once it's stayed unchanged for `delayMs` (default 300) |
| `useMediaQuery.ts` | Live boolean for whether a CSS media query currently matches — for a breakpoint decision made in JS logic, not plain Tailwind `md:`/`lg:` |
| `useInView.ts` | `[ref, inView]` via `IntersectionObserver` — gate a lazy fetch/animation on an element actually scrolling near/into view. `rootMargin` (default `300px`) starts it slightly before the element is on screen; `once` (default `true`) disconnects after the first trigger instead of toggling back to `false` on scroll-out |

`useHorizontalScroll.ts` and `useParallax.ts` moved to the sibling **`extras/`** kit — optional,
copy in only if a project wants that specific enhancement (see its README for why).

### `components/transitions/` — reusable animation wrappers, one per file

Drop into `src/components/transitions/`. All of them read the shared motion tokens (see
`motion.css` — merge into your `globals.css`) so speed/stagger/easing stay consistent everywhere.

| Wrapper | File | Use |
|---|---|---|
| `<RevealUp>` | `reveal_up/` | Entrance on mount: slide up + fade. `animate={false}` for above-the-fold text/hero (an element that starts at `opacity:0` is excluded from LCP measurement) |
| `<RevealOnScroll>` | `reveal_on_scroll/` | Entrance on scroll-into-view (`IntersectionObserver`-gated, fires once); below-fold content |

Both re-trigger via a changing React `key`, and stagger siblings with `step={n}` (delays by
`n × --motion-delay-step`). `motion.css` includes the reduced-motion collapse.

`<Parallax>` and `<SmoothScroll>` moved to the sibling **`extras/`** kit — both are a real per-project
call (does this page want parallax drift? does the site want Lenis's momentum feel?), not a default
to reach for. They still read this same `motion.css`, so merge it in regardless of whether you copy
either of them.

### `providers/ScrollRestoration.tsx` + `utils/scroll_restoration.ts` — back/forward scroll memory

Saves per-URL scroll position, restores it on browser back/forward. The listener setup lives in
`scroll_restoration.ts` (module-scoped, so it survives the shell remounting on a suspended page) —
`ScrollRestoration` just kicks off the one-time init on mount. Drop the provider once near your app
root (e.g. in the root layout's client-providers wrapper).

The file's header comment maps the whole flow (SAVE → RESTORE → PUBLISH). Eight things in it are
non-obvious and each came from a real "Back didn't land where I left off" bug — don't simplify them
away:

1. **Three save triggers, not one.** `scroll` (user scrolling), `pagehide` (real unload: tab close,
   hard refresh), and a capture-phase `click` (in-app SPA navigation, which never fires `pagehide`).
   Without the click one, a URL visited briefly and left *without scrolling* keeps whatever position
   an EARLIER visit saved, and a later Back restores that stale value.
2. **Never save while a restore is running.** The loop re-asserts `scrollTo()` ~90 times and each
   call emits a scroll event; `scrollY` is still climbing, and is *clamped* while a progressively
   rendered page is too short to reach the target. Saving then overwrites the good position with a
   partial one — and if the user clicks away mid-restore, that partial value is what persists.
3. **Restore re-asserts per frame rather than scrolling once**, because the router may issue its own
   scroll-to-top just after, and a lazily-rendered page may still be too short to reach the target.
   Bails immediately on `wheel`/`touchmove`/`keydown`/`click` — real user intent outranks history.
4. **One loop at a time, cancelled before *every* restore — including the no-target path.** Each
   `popstate` builds its own `stop()` closure. Cancel must happen before the "nothing saved" early
   return, or a rapid back/forward into a URL with no stored position leaves the previous loop alive,
   scrolling the OLD page's offset onto the new page for the rest of its ~1.5s budget. And a loop may
   only clear the shared target if it still owns it, or an older run wipes a newer run's state.
5. **`getActiveRestoreTarget()` exists so page chrome doesn't read a lagging `scrollY`.** A header
   deciding transparent-vs-solid, a hide-on-scroll bottom bar, or a progressive block loader that
   mounts mid-restore should size against where the page is *going*. Two corollaries: a hide-on-scroll
   consumer must also skip its logic (and clear pending timers) while a restore is in flight, or the
   restore's own programmatic scrolling reads as a fast user swipe; and anything that defers
   below-fold content should treat an in-flight restore as its own "load it now" signal, or the page
   stays too short for the restore to reach its target.
6. **A saved position of `0` is a real target — only `null` is a no-op.** It is tempting to skip the
   restore when the stored value is 0, on the logic that a page "already opens at the top". It does
   not. In a single-document SPA the window is still sitting at the offset of the page you just left
   when `popstate` fires, and `history.scrollRestoration = 'manual'` means nothing resets it but you.
   Skipping leaves that stale offset in place, clamped into whatever height the incoming page happens
   to have at that instant — so leaving a page from the top, scrolling the next one deep, and going
   Back lands you partway down. Worse with deferred/progressive rendering, because the incoming page
   is at its shortest exactly then. Symptom is "Back goes *almost* to the top", which reads like a
   rounding bug and is not.
7. **`window.scrollY` lies whenever a body scroll lock is active** — and `useBodyScrollLock` in this
   same kit is such a lock. It pins `<body>` with `position: fixed`, so the document is not scrolled
   at all and `scrollY` reads 0 regardless of where the user actually was. Since the lock fires a
   scroll event on engaging, and since drawer links are a normal way to navigate, the save path will
   happily record 0 and destroy the real position: open a hamburger at 1500, tap a link inside it,
   come Back later, land at the top. Read the offset the lock stashes (`<html>`'s
   `data-scroll-lock-y`) and fall back to `window.scrollY` only when it is absent. Do **not** just
   skip saving while locked — in the drawer-link flow the navigation *originates* inside the lock, so
   the save still has to happen, just with a truthful number. Any other lock implementation needs the
   same treatment; if yours doesn't record the pre-lock offset anywhere, make it.
8. **Reject a blank saved entry instead of parsing it as 0.** `Number('')` and `Number('   ')`
   both evaluate to `0`, not `NaN` — so a corrupt/empty `sessionStorage` value passes a bare
   `Number.isFinite` check and reads as a legitimate "restore to top" target. Harmless while note 6
   above was still unfixed (0 was a no-op either way), but once 0 became a real target this would
   actively scroll the page to the top on a corrupt entry. Trim and reject blank before parsing;
   reject negatives too, since no real scroll offset is ever negative.

### `providers/QueryProvider.tsx` — TanStack Query defaults

Wraps the app in a `QueryClientProvider` with one `QueryClient` instance created once via
`useState(() => ...)` (never re-created across re-renders). Sets the app-wide defaults every
`useApiQuery`/`useApiMutation` call inherits: `staleTime` 5min, `gcTime` 10min, `retry` 0 for
queries / 1 for mutations, exponential retry backoff capped at 30s, no refetch-on-window-focus.
Adjust these numbers to your project's actual data-freshness needs — they're a starting point,
not a law.

### `utils/view_transition.ts` — View Transitions API helpers

Two helpers: `startStateTransition(update)` crossfades a synchronous same-page state change (e.g. a
PDP color swap — see `pdp-color-swap/`) using `flushSync` + `document.startViewTransition`;
`startRouteTransition(navigate)` crossfades a route navigation, holding the transition open briefly so
the new route can paint. Both fall back to an instant update when the API is unsupported or the user
prefers reduced motion. Needs no extra CSS for a plain root crossfade — the browser's default is
enough unless you customize `::view-transition`. `startStateTransition` returns `{ finished }` (a
promise) — you only need it for the dialog-safe pattern below; ignore it for a normal same-page swap.

#### Dialog-safe usage — calling this from inside an open Radix Dialog (or similar)

If you call `startStateTransition` to update state **while a modal/dialog is open** (e.g. switching a
tab inside a drawer), you can hit a real bug: **the dialog closes itself** the next time you tap
another tab. Here's why, and the fix that actually works (a naive fix does not — see below).

**Why it happens:** a browser view transition doesn't restore live, hit-testable rendering the
instant your update commits — it stays frozen (replaced by a static snapshot) until *every* named
transition group's own animation finishes, and that's gated on the *slowest* group, not each group
independently. If your dialog is mid-transition-freeze when a tap lands, the tap falls through to
whatever's behind the dialog instead of hitting it, and a Radix `DismissableLayer` (or equivalent
outside-click detection) reads that as an outside interaction and closes the dialog.

**What does NOT fully fix it:** giving the dialog's own overlay/content elements a
`view-transition-name` and pinning them with `animation: none` (the same technique used for
persistent chrome like a header/footer during a route crossfade — see the pattern in this repo's
`components/transitions/motion.css` for that unrelated, safe use case). This stops the dialog from
*visually* flickering, but it does **not** restore its interactivity sooner — the whole transition
still doesn't finish until the slowest group (e.g. the tab content's own crossfade) completes, so a
tap can still fall through during that window even though the dialog looks static and unchanged.

**The fix that works — guard the close, not the timing:**

```tsx
const isTransitioningRef = useRef(false);
// Identifies the latest call so a superseded transition settling first can't
// clear the guard while a newer one is still in flight (e.g. the user taps
// two tabs in quick succession — the first tap's transition may resolve
// after the second tap's has already started a new one).
const transitionTokenRef = useRef(0);

const changeTab = (next: Tab) => {
  const token = ++transitionTokenRef.current;
  isTransitioningRef.current = true;
  const clearGuard = () => {
    if (transitionTokenRef.current === token) isTransitioningRef.current = false;
  };
  // .then(clearGuard, clearGuard) — not .finally() — because .finished can
  // reject (the update callback throwing) and .finally() alone would leave
  // that rejection unhandled instead of actually catching it.
  startStateTransition(() => setActiveTab(next)).finished.then(clearGuard, clearGuard);
};

<Dialog
  open={open}
  onOpenChange={(nextOpen) => {
    // Swallow a close that fires while our own transition is still in flight —
    // it's the spurious "tap fell through a frozen dialog" case above, not a
    // real dismiss intent.
    if (!nextOpen && isTransitioningRef.current) return;
    setOpen(nextOpen);
  }}
>
```

This sidesteps needing to reason precisely about browser-specific transition timing — it blocks the
one symptom that matters (spurious close) regardless of how long the freeze actually lasts. Keep the
CSS pin too if you have persistent chrome elsewhere that would otherwise flicker during transitions —
it's complementary, not a substitute.

### `utils/` — string, time, phone formatting, and the star-fill math

| File | What it is |
|---|---|
| `html.ts` | `stripTags` (plain text from an HTML fragment), `splitBrLines` (split a `<br>`-delimited string into trimmed lines), `stripFontSize` (strip inline `font-size` CSS so your own type scale wins — CKEditor/rich-text output) |
| `bot.ts` | `isBotUserAgent(ua)` — broad search/social/AI-crawler user-agent regex, for deciding whether a crawler gets the full server-rendered page instead of an interaction-gated shell |
| `time_ago.ts` | `toTimeAgo(iso)` — relative-time formatter ("3 minutes ago" → "2 days ago" → "1 year ago") |
| `format.ts` | `formatRating(value)` (one-decimal rating string, correct half-rounding); `formatPhone(phone, country?)` (spaces a phone number, makes the country code visible) |
| `strings.ts` | `safeJsonParse(raw, fallback)` (never throws); `resolveTemplate(text, value)` (resolves a `{{name \|\| "fallback"}}`-style placeholder) |
| `icons/star_icon.tsx` | `getStarFill(rating, index)` — area-accurate star-rating fill math, not a naive width clip. Worth reading in full — see below |

The star-fill math is the one worth reading closely, not just copying:

`getStarFill(rating, index)` solves a real, non-obvious visual bug: a naive "clip the star SVG at
`rating% width`" approach looks wrong, because this star's 5-point mass sits left-of-center — a plain
75%-width clip only trims the thin right point, so it reads as ~89% filled *by area*, not 75%. A 4.7
rating's last star looked visually indistinguishable from a full one.

The fix: a lookup table mapping *intended fill fraction* → *the clip-width% that actually produces that
much visible area*, sampled every 10% along the star's own polygon and linearly interpolated between
samples. `getStarFill` looks up where the current star sits in the rating (`rating - index`, clamped
0–1) and returns the corrected clip-width.

This generalizes to **any** non-trivial SVG shape you need to partially fill proportionally by visual
area rather than by bounding-box width — the technique (sample real area at N points, interpolate,
correct the naive linear clip) is the reusable part, not just this specific star polygon.

## Adapt before use

- **Import alias**: everything uses `@/components/ui/*`, `@/assets/icons/*`, `@/hooks/*`, `@/utils/*`.
  If the new project's `tsconfig.json` maps `@/*` → `src/*` (the common Next.js convention) and you
  drop these files at the paths listed above, **no import rewriting needed**.
- **`alink.tsx`'s analytics calls** (`track.content.aboutUsClick`, `track.nav.cta(...)`) are wired to a
  specific project's analytics dispatcher (`@/lib/analytics`) with its own event taxonomy. Either build
  an equivalent `track` module, or strip those two call sites and keep the rest of the component
  (hover/CTA styling, `next/link` wrapping) as-is.
- **`utils/helpers.ts`** here is a 1-line extract (`isVideoUrl`) from a much larger project helpers
  file — just enough for `media.tsx`/`video.tsx` to resolve. Add your own project's other helpers
  alongside it.
- **Peer dependencies**: `@radix-ui/react-accordion`, `@radix-ui/react-dialog`, `@radix-ui/react-select`,
  `@radix-ui/react-popover` + `react-day-picker` (for `date_picker.tsx`),
  `embla-carousel` + `embla-carousel-react` + `embla-carousel-autoplay`, `clsx` + `tailwind-merge` (via
  `cn` — see the `fluid-setup` kit's `cn.ts` if you don't have one), `next` (Image/Link), `react-dom`
  (for `Picture`'s `preload()` and `view_transition.ts`'s `flushSync`), `country-state-city` (for
  `format.ts`'s `formatPhone`). `lenis` is only needed if you also copy `extras/`'s `<SmoothScroll>`.
- **`edge_scroll` vs `carousel`** are two different patterns for two different jobs — don't conflate
  them: `edge_scroll` is a scroll-**snap row** (multiple cards visible, native scroll — desktop mouse
  wheel is an opt-in bolt-on via `extras/hooks/useHorizontalScroll.ts`, not included by default);
  `carousel` is a one-slide-at-a-time embla carousel (loop, autoplay, drag). Pick based on the
  design, not habit.
