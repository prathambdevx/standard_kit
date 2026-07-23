---
name: ios-safari-fixes
description: iOS Safari renders web UI differently from every other engine in a handful of specific, recurring ways — SVG clipping, viewport-height units, input auto-zoom, scroll-lock, safe-area insets, a repaint-shimmer precaution, plus a cross-platform address-bar-collapse pattern for full-screen overlays. Apply these rules proactively while writing any component with an SVG, a text input, a full-viewport element, a bottom-fixed bar, a scroll-locking overlay, a full-screen drawer/modal, or SVGs next to a continuously-repainting region, so the bug never ships instead of getting caught in iPhone/Android QA later.
user-invocable: false
---

# iOS Safari fixes — bake these in, don't wait for QA to find them

Rules 1–6 were each learned from a real bug that shipped, got caught on a physical iPhone (never
reproduced in Chrome DevTools' device emulation), and had to be fixed after the fact. Rule 7 is a
general repaint precaution, not a confirmed shipped bug (see its note). Rule 8 extends rule 4 to
cover Android Chrome's toolbar-collapse alongside iOS's, for overlays opened mid-scroll. Apply them
while writing the code so there's nothing to catch later.

## 1. SVGs clip their own artwork at the viewBox edge

**The bug:** iOS Safari's UA stylesheet sets `overflow: hidden` on every `<svg>` by default. Any
stroke halo or curve that touches the viewBox edge gets shaved — circular icon rings, a heart
icon's lobes, a star's points. Sub-pixel at normal icon size, clearly visible zoomed in or on a
high-DPR device. Chrome and Firefox don't clip this, so the bug is **invisible** until you check
on real iOS Safari.

**The fix — a global default, not a per-icon patch:**

```css
/* apply once in globals.css, @layer base */
@layer base {
  svg {
    overflow: visible;
  }
}
```

An `overflow-hidden` utility on a specific `<svg>` instance still wins (this is `@layer base`, low
specificity). If an SVG genuinely needs to self-clip (e.g. a partial-fill graphic), clip it via a
**wrapping `<div>`**, never the `<svg>`'s own `overflow`.

See `css/ios-safari.css` for the drop-in snippet.

## 2. `w-auto`/`h-auto` on an SVG with a hardcoded width/height attribute

**The bug:** iOS Safari ignores an `w-auto`/`h-auto` Tailwind class when the `<svg>` element also
carries a literal `width="179"` / `height="22"` **attribute** — it keeps the attribute's pixel
value as the rendered size instead of recomputing from the CSS box + aspect ratio. The visible
result: the icon renders at its raw intrinsic size regardless of the parent's actual height,
cropping it (a logo's right edge cut off, a nav icon's swatch clipped).

```tsx
// ❌ iOS Safari ignores w-auto here — logo renders at its literal 179px width
// attribute regardless of the parent's actual height, cropping the right edge
<BscLogo className="h-[16px] w-auto lg:h-[22px] lg:w-[179px]" />

// ✅ Explicit width at every breakpoint, matching the real viewBox aspect ratio
<BscLogo className="h-[16px] w-[130px] lg:h-[22px] lg:w-[179px]" />
```

**Rule: never pair `w-auto`/`h-auto` with an SVG that has hardcoded `width`/`height` attributes.**
Compute the correct width from the SVG's own `viewBox` aspect ratio and give it explicitly at
every breakpoint the height changes. (If the SVG component doesn't hardcode width/height
attributes at all — just a `viewBox` — this bug doesn't apply; `w-auto`/`h-auto` is fine there.)

## 3. Sub-16px text on a focused input triggers auto-zoom

**The bug:** iOS Safari zooms the entire viewport in when a focused text-entry control renders
below 16px — the OS's way of making tiny text legible. The user then has to manually pinch back
out. It reads as broken, not helpful.

```tsx
// ❌ 14px on mobile — Safari zooms in on focus
<input className="text-[14px] lg:text-[16px]" />

// ✅ 16px everywhere — no zoom, ever
<input className="text-[16px]" />
```

**Rule: every `<input>`/`<textarea>`/`<select>` renders at ≥16px on mobile, full stop** — don't
step it up only at `lg:`. If the design genuinely wants smaller text, that's not achievable on
iOS without the zoom; push back on the design instead of shipping the zoom.

(If you're also using the `fluid-setup` kit, this is the same *reason* behind its
`fl-input-floor` validator rule — that one catches `fl-text-[a,…]` tokens on files you've listed
as input atoms. `check-ios-safari.mjs` in this kit catches the same bug more broadly: any raw
`text-[Npx]` / `text-sm` / `text-xs` on any input/textarea/select, fluid system or not.)

## 4. `dvh` resizes as the URL bar hides/shows — use `svh` for anything that must hold still

**The bug:** `100dvh` tracks the **live** viewport, which iOS Safari continuously resizes as its
URL bar collapses/expands on scroll. Anything sized with `dvh` visibly grows/shrinks or jumps
mid-interaction — a fullscreen lightbox image, a hero locked to "one screen," a modal capped at
"the viewport."

```tsx
// ❌ resizes/overflows as the iOS URL bar animates
style={{ maxHeight: 'calc(100dvh - 150px)' }}

// ✅ svh = smallest viewport height — stable through the whole URL-bar animation
style={{ maxHeight: 'calc(100svh - 150px)' }}
```

**Rule: use `svh`, not `dvh` or bare `vh`, for anything that must never resize mid-interaction**
(fullscreen overlays, a hero pinned to one screen, height reserved so a footer can't ride up
before content streams in). `dvh` is fine when you actually want live-viewport tracking — that's
a smaller set of cases than it first appears.

## 5. Scroll-locking a modal/drawer needs `position: fixed`, not `overflow: hidden`

**The bug:** iOS Safari ignores `overflow: hidden` on `<body>` (or `<html>`) for touch-drag — the
page behind a modal/drawer keeps scrolling under the user's finger regardless. The only reliable
iOS lock is pinning the body with `position: fixed` (and restoring scroll position on unlock).

```tsx
// ❌ no-op on iOS — touch-drag scrolls the page behind the modal anyway
document.body.style.overflow = 'hidden';

// ✅ the one reliable technique
const scrollY = window.scrollY;
document.body.style.position = 'fixed';
document.body.style.top = `-${scrollY}px`;
document.body.style.width = '100%';
// on unlock: clear the above, then window.scrollTo(0, scrollY)
```

**Don't hand-roll this per component** — use a single shared, ref-counted scroll-lock hook so
every overlay in the app (drawers, search, lightbox, size guide, customizer, …) behaves
identically and overlapping locks (one overlay opening another) don't fight each other. See
`useBodyScrollLock` in the `ui-components` kit — it's this exact fix, already implemented,
ref-counted via a DOM attribute (survives hot-reload), and documented inline.

## 6. `env(safe-area-inset-bottom)` stacks if applied twice in the same ancestor chain

**The bug:** a bottom-fixed bar's outer wrapper adds `pb-[env(safe-area-inset-bottom)]`, and its
inner content *also* adds `pb-[calc(32px+env(safe-area-inset-bottom))]` — the inset gets added
twice, over-padding the bar on notched iPhones (extra dead space above the home indicator).

```tsx
// ❌ double-counts the inset — outer AND inner both add it
<div className="fixed bottom-0 pb-[env(safe-area-inset-bottom)]">
  <div className="pb-[calc(32px+env(safe-area-inset-bottom))]">…</div>
</div>

// ✅ exactly one ancestor in the chain applies it
<div className="fixed bottom-0">
  <div className="pb-[calc(32px+env(safe-area-inset-bottom))]">…</div>
</div>
```

**Rule: every bottom-fixed bar, sticky CTA, and modal on mobile respects
`safe-area-inset-bottom` — but exactly once per element chain.** Before adding it, check whether
a parent or child in the same stack already does.

## 7. SVGs shimmering in place next to a repainting region

> First surfaced as a footer "payment icons flicker" report — the SVG payment icon row visibly
> re-rendering while the FAQ accordion above it animates its height. A scroll/layout-jerk theory was
> investigated alongside this (see the "footer FAQ accordion" entry in `ISSUES.md`) but turned out
> not to be a real, reproduced issue — the actual bug was always this repaint shimmer, fixed with the
> `transform-gpu` layer promotion below.

**The behavior:** when a nearby region repaints continuously (a canvas, a CSS-filter/backdrop
animation, an element animating a non-composited property), iOS Safari can repaint adjacent
static content — SVGs especially — on the same non-composited pass, making them *shimmer in place*.
Chrome/Firefox composite differently and don't show it, so it's iOS-only and invisible in emulation.

**Fix — pin the static content to its own compositing layer** so iOS paints it once and leaves it
alone:

```tsx
// ✅ transform-gpu → transform: translateZ(0) (forces a compositing layer)
//    backface-hidden → backface-visibility: hidden (WebKit repaint stabilizer)
<div className="flex transform-gpu items-center gap-4 backface-hidden">
  <SomeIcon /> {/* … */}
</div>
```

The promotion has no layout effect and is safe to leave on. (Not a lint rule — apply by eye.)

**Do NOT use this for a vertical jerk.** If the element *moves/jumps* rather than shimmering in a
fixed spot, the cause is a reflow or scroll re-clamp (e.g. a `height`-animating accordion changing
document height while scrolled to the bottom), not a repaint — layer promotion won't touch it. That
class of bug lives in `ISSUES.md`.

## 8. A full-screen mobile overlay needs to survive the address bar collapsing/expanding on EITHER platform, not just iOS

**The bug — two different failure modes on two different platforms, from the same root cause:**
Rule 4 says "use `svh`, not `dvh`, for anything that must hold still" — true on iOS, but incomplete.
`svh` is the **smallest** possible viewport (address bar visible). If a full-screen drawer/overlay
is opened on **Android Chrome** while the user had already scrolled and the toolbar was collapsed
(bigger real viewport), the overlay renders shorter than the actual screen — a gap at the bottom,
page content peeking through. Switching that same overlay to `dvh` "fixes" the Android gap but
reintroduces the exact iOS jank rule 4 warned about (`dvh` recalculates live as Safari's toolbar
animates, causing visible jitter). Neither unit alone is correct for a mobile-toolbar-aware overlay
that has to work on both platforms.

**The fix — measure once in JS, freeze it, never touch it again:**

```ts
// useLockedViewportHeight.ts — see ui-components kit
export const useLockedViewportHeight = (active: boolean) => {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!active) { setHeight(null); return; }
    setHeight(window.visualViewport?.height ?? window.innerHeight);
  }, [active]);
  return height;
};
```

```tsx
// ❌ svh alone — gap on Android if opened while the toolbar is already collapsed
<div className="h-svh">

// ❌ dvh alone — no gap, but jitters on iOS as the toolbar animates
<div className="h-dvh">

// ✅ svh as the pre-measurement fallback, overridden by a one-time JS snapshot once mounted
const lockedVh = useLockedViewportHeight(open);
<div
  className="h-[var(--locked-vh,100svh)]"
  style={lockedVh ? ({ '--locked-vh': `${lockedVh}px` } as React.CSSProperties) : undefined}
>
```

**Why this doesn't reintroduce the `dvh` jank:** the measurement happens exactly once, in an effect
keyed on `open` — not on scroll, not on resize, not every render. Once `--locked-vh` is set it's a
static pixel number; there's nothing left for the browser to recompute as the toolbar animates, so
there's no per-frame layout thrash. This is strictly better than `dvh` for this case: it gets the
correct height on Android (measured at the real, current viewport) *and* stays static through
whatever the toolbar does afterward on iOS.

**Why a CSS var, not an inline `height` directly:** an inline `style` always wins over a class
regardless of media query, so writing `height: 847px` directly on the element would also clobber a
desktop `lg:h-[...]` override meant to replace the mobile sizing at wider viewports. Routing the
measured value through `var(--locked-vh, <fallback>)` means the base (mobile) class asks "what's
this variable right now," while the desktop override class doesn't reference the variable at all
and simply wins normally via the ordinary Tailwind cascade at its breakpoint.

**Rule: any full-screen mobile overlay/drawer that must not visibly resize should use this pattern,
not `svh` or `dvh` alone** — plain `svh` is still fine for content that isn't opened as a drawer
mid-scroll (a static hero, a lightbox reached by page-load rather than a scrolled-then-tapped CTA),
where the toolbar-already-collapsed-at-open scenario doesn't apply.

## The validator (`scripts/check-ios-safari.mjs`)

Run `bun scripts/check-ios-safari.mjs` (or point it at specific files) to catch rules 2, 3, 4, and
6 mechanically — a linter, not a browser, so it flags likely offenders for confirmation rather
than proving the bug. Wire it into your commit gate the same way `fluid-setup`'s `check-fluid.mjs`
is wired (see `wiring/lefthook-snippet.yml`). Rule 1 (the base CSS fix) and rule 5 (scroll-lock)
aren't lint rules — they're a one-time global CSS change and a shared hook, respectively; nothing
to scan for once they're in place.

| Rule | Severity | Catches |
|---|---|---|
| `svg-auto-size` | error | `w-auto`/`h-auto` paired with a hardcoded width/height attribute on `<svg>` |
| `input-zoom` | error | sub-16px `text-[Npx]` / `text-sm` / `text-xs` on `<input>`/`<textarea>`/`<select>` |
| `dvh-usage` | info | any `NNdvh` usage — a nudge to confirm `svh` isn't the better fit, not a hard error |
| `safe-area-double-stack` | warn | `env(safe-area-inset-bottom)` appearing 2+ times in one file |

## Why "test on a real device" isn't a substitute for these rules

None of the rules above reproduce in Chrome DevTools' iOS device emulation — device emulation
simulates viewport size and touch events, not the actual WebKit rendering quirks (SVG UA
clipping, `w-auto` attribute precedence, the URL-bar-driven `dvh` resize, `overflow:hidden`
touch-drag behavior). They only ever surfaced on a physical iPhone in QA, after the code had
already shipped. Baking the rules in during authoring is strictly cheaper than catching them
later — that's the entire point of this folder.
