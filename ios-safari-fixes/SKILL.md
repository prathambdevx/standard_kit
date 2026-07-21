---
name: ios-safari-fixes
description: iOS Safari renders web UI differently from every other engine in a handful of specific, recurring ways — SVG clipping, viewport-height units, input auto-zoom, scroll-lock, safe-area insets, compositing-layer flicker. Apply these rules proactively while writing any component with an SVG, a text input, a full-viewport element, a bottom-fixed bar, a scroll-locking overlay, or an element sitting next to a height/layout animation, so the bug never ships instead of getting caught in iPhone QA later.
user-invocable: false
---

# iOS Safari fixes — bake these in, don't wait for QA to find them

Every rule below was learned from a real bug that shipped, got caught on a physical iPhone (never
reproduced in Chrome DevTools' device emulation), and had to be fixed after the fact. Apply them
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

## 7. SVGs (or any static element) flicker next to a height/layout animation

**The bug:** an accordion, collapsible, or `max-height` reveal animates the CSS `height` property.
`height` isn't GPU-composited, so every frame forces iOS Safari to re-layout **and repaint**
everything that shifts below the animating element. Any SVGs caught in that repaint path — a row of
payment icons directly under a footer FAQ accordion, say — get repainted on a non-composited layer
each frame and visibly flicker. Chrome and Firefox composite/paint here differently and don't show
it, so it's iOS-only and never reproduces in device emulation.

```tsx
// ❌ the payment-icon row flickers every time the accordion above it opens/closes
<div className="flex items-center justify-between gap-4">
  <VisaIcon /> <MastercardIcon /> {/* … */}
</div>

// ✅ pin the row to its own compositing layer — iOS paints it once, then just
// translates the layer as the accordion animates (no per-frame SVG repaint)
<div className="flex transform-gpu items-center justify-between gap-4 backface-hidden">
  <VisaIcon /> <MastercardIcon /> {/* … */}
</div>
```

`transform-gpu` → `transform: translateZ(0)` (forces the compositing layer); `backface-hidden` →
`backface-visibility: hidden` (the WebKit repaint stabilizer). **Rule: when a static element —
especially one containing SVGs — sits adjacent to a sibling that animates `height`/`max-height` or
any layout property, promote that static element with `transform-gpu backface-hidden`.** Prefer
fixing the flickering neighbour over the animation itself; the layer promotion has no layout effect
and is safe to leave on. (Not a lint rule — the adjacency is contextual; apply it by eye when you
build the animating layout.)

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

None of the 7 bugs above reproduce in Chrome DevTools' iOS device emulation — device emulation
simulates viewport size and touch events, not the actual WebKit rendering quirks (SVG UA
clipping, `w-auto` attribute precedence, the URL-bar-driven `dvh` resize, `overflow:hidden`
touch-drag behavior). They only ever surfaced on a physical iPhone in QA, after the code had
already shipped. Baking the rules in during authoring is strictly cheaper than catching them
later — that's the entire point of this folder.
