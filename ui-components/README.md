# ui-components — atom library + carousel + scroll hook + star-fill math

A set of production UI atoms (Radix-based where interaction/a11y is non-trivial, plain otherwise),
an embla-powered carousel, a mouse-wheel scroll hook, and a genuinely reusable bit of math (area-
accurate star-rating fill). Pulled from a real Next.js 15 + Tailwind v4 app — copy in, wire the
import alias, done.

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
| `img.tsx` | `<Img>` — `next/image` wrapper: custom CDN loader (2x DPR), `showLoader` spinner-gated lazy load, graceful fallback box on missing/failed `src` (never the browser's broken-image icon) |
| `picture.tsx` | `<Picture>` — separate mobile/desktop image sources with `preload()` for the LCP candidate |
| `alink.tsx` | `<Alink>` — `next/link` wrapper with hover/CTA styling + analytics hooks (see Adapt below) |
| `accordion.tsx` | Radix accordion wrapper (single/multiple, animated open/close) |
| `drawer.tsx` | Radix dialog-based bottom-sheet/side-panel shell — header/body/footer slots, body-scroll-lock, ripple close button |
| `field_error.tsx` | Small inline form-error message atom |
| `media.tsx` | Polymorphic image-or-video renderer (checks `isVideoUrl`, renders `<Img>` or `<Vid>` accordingly) |
| `select.tsx` | Radix select wrapper |
| `video.tsx` | Custom video player — play/pause/mute controls, custom icons |
| `hover_zoom_image.tsx` | Wraps an `Img`/`Picture` to scale up slightly on hover (pairs with a `group` class on the parent) |
| `star_rating.tsx` | Interactive star picker (hover preview, controlled value) |
| `carousel.tsx` + `carousel_dots.tsx` | Embla-powered carousel (loop, autoplay, drag) + a paired dot-indicator strip |
| `edge_scroll/index.tsx` | Scroll-snap row wrapper (native overflow-scroll + touch, NOT embla) for card rails — see the mouse-wheel note below |
| `ripple.tsx`, `scroll_area.tsx`, `loading_spinner.tsx` | Small shared primitives several atoms above depend on |

### `icons/` — drop into `src/assets/icons/`

One SVG-wrapper-per-file convention (`aria-hidden`, `currentColor` fill/stroke). Includes the icons
`video.tsx`/`select.tsx`/`drawer.tsx` reference, plus **`star_icon.tsx`** — see below, it's the one
with the math.

### `hooks/` — drop into `src/hooks/`

- **`useHorizontalScroll.ts`** — makes a horizontally-scrolling row (like `edge_scroll`) respond to a
  **plain desktop mouse wheel** (no trackpad, no touch). Detects a real wheel vs. a trackpad pan via
  `deltaMode`/`wheelDeltaY`, eases toward the scroll target via `requestAnimationFrame`, disables/
  re-enables `scroll-snap-type` around the ease, and bails at the scroll edge so page scroll isn't
  trapped. Wire it into your own scroll-row component the way `edge_scroll/index.tsx` does (merged
  ref) — it's a hook, not a wrapper component, so it composes into whatever rail markup you have.
- **`useBodyScrollLock.ts`** — locks page scroll while a drawer/modal is open (used by `drawer.tsx`).
- **`useParallax.ts`** — scroll-linked vertical translate for a layer inside an `overflow-hidden`
  frame; `speed` is the fraction of the element's own height it travels across a full viewport pass.
  Honors `prefers-reduced-motion`. Pairs with `components/transitions/parallax/`.

### `components/transitions/` — reusable animation wrappers, one per file

Drop into `src/components/transitions/`. All of them read the shared motion tokens (see
`motion.css` — merge into your `globals.css`) so speed/stagger/easing stay consistent everywhere.

| Wrapper | File | Use |
|---|---|---|
| `<RevealUp>` | `reveal_up/` | Entrance on mount: slide up + fade. `animate={false}` for above-the-fold text/hero (an element that starts at `opacity:0` is excluded from LCP measurement) |
| `<RevealOnScroll>` | `reveal_on_scroll/` | Entrance on scroll-into-view (`IntersectionObserver`-gated, fires once); below-fold content |
| `<Parallax>` | `parallax/` | Scroll-linked vertical drift for a layer inside an `overflow-hidden` frame (editorial imagery) |
| `<SmoothScroll>` | `smooth_scroll/` | Mounts Lenis momentum smooth-scrolling for the page's lifetime (peer dep: `lenis`) |

Both `<RevealUp>`/`<RevealOnScroll>` re-trigger via a changing React `key`, and stagger siblings with
`step={n}` (delays by `n × --motion-delay-step`). `motion.css` includes the reduced-motion collapse.

### `providers/ScrollRestoration.tsx` + `utils/scroll_restoration.ts` — back/forward scroll memory

Saves per-URL scroll position as the user scrolls, restores it on browser back/forward. The listener
setup lives in `scroll_restoration.ts` (module-scoped, so it survives the shell remounting on a
suspended page) — `ScrollRestoration` just kicks off the one-time init on mount. Drop the provider
once near your app root (e.g. in the root layout's client-providers wrapper).

### `utils/view_transition.ts` — View Transitions API helpers

Two helpers: `startStateTransition(update)` crossfades a synchronous same-page state change (e.g. a
PDP color swap) using `flushSync` + `document.startViewTransition`; `startRouteTransition(navigate)`
crossfades a route navigation, holding the transition open briefly so the new route can paint. Both
fall back to an instant update when the API is unsupported or the user prefers reduced motion. Needs
no extra CSS — the browser's default root crossfade is enough unless you customize `::view-transition`.

### `utils/` — string, time, and phone formatting

- **`html.ts`** — `stripTags` (plain text from an HTML fragment), `splitBrLines` (split a
  `<br>`-delimited string into trimmed lines), `stripFontSize` (strip inline `font-size` CSS so your
  own type scale wins — useful for CKEditor/rich-text output).
- **`bot.ts`** — `isBotUserAgent(ua)`, a broad search/social/AI-crawler user-agent regex (Google,
  Bing, GPTBot, ClaudeBot, Perplexity, common social-preview bots, …) for deciding whether a crawler
  should get the full server-rendered page instead of an interaction-gated shell.
- **`time_ago.ts`** — `toTimeAgo(iso)`, a relative-time formatter ("3 minutes ago" → "2 days ago" →
  "4 months ago" → "1 year ago").
- **`format.ts`** — `formatRating(value)` (one-decimal rating string, correct half-rounding);
  `formatPhone(phone, country?)` (spaces out a phone number and makes the country code visible —
  tolerant of a missing `+` prefix, inferring the dial code from the country name via the
  `country-state-city` peer dep).
- **`strings.ts`** — `safeJsonParse(raw, fallback)` (never throws); `resolveTemplate(text, value)`
  (resolves a `{{name || "fallback"}}`-style placeholder — rename the token to match your own
  templating convention).

### The star-rating math (`icons/star_icon.tsx`) — the one worth reading closely

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
  `embla-carousel` + `embla-carousel-react` + `embla-carousel-autoplay`, `clsx` + `tailwind-merge` (via
  `cn` — see the `fluid-setup` kit's `cn.ts` if you don't have one), `next` (Image/Link), `react-dom`
  (for `Picture`'s `preload()` and `view_transition.ts`'s `flushSync`), `lenis` (for `SmoothScroll`),
  `country-state-city` (for `format.ts`'s `formatPhone`).
- **`edge_scroll` vs `carousel`** are two different patterns for two different jobs — don't conflate
  them: `edge_scroll` is a scroll-**snap row** (multiple cards visible, native scroll + `useHorizontalScroll`
  for desktop mouse-wheel support); `carousel` is a one-slide-at-a-time embla carousel (loop, autoplay,
  drag). Pick based on the design, not habit.
