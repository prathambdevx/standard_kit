# Virtualization & windowing — two tools for "scroll is choppy on iOS"

Two hooks that fix two *different* diseases with the same symptom. Picking the wrong one does
nothing — we burned six dead theories learning that (full story: [`case-study.md`](./case-study.md)).

## The mental model first: CPU vs GPU

A phone renders a page with two workers:

- **CPU — the thinking side.** Runs JS, builds DOM, computes layout, decodes images, runs
  observers/listeners. Cost scales with **how many live things exist**. CPU jank = things
  stutter when they *happen* (taps, re-renders, scroll handlers doing work).
- **GPU — the drawing side.** Holds finished pre-drawn pictures ("layers") and blends them
  each frame. A layer's memory is `width × height × 4 bytes` — **content irrelevant**: a grey
  placeholder costs exactly what a product photo costs. GPU jank = things stutter while merely
  *moving*, with the **main thread idle**.

> **CPU pays for what exists; GPU pays for what's drawn. Virtualization removes what exists
> inside a fixed area; windowing shrinks the area.**

**The vertical/horizontal asymmetry** (the single most useful fact here): the page's own
vertical content lives on the document layer, which is **tiled** — the browser keeps only
tiles near your scroll position and drops the rest automatically. A 200-product vertical grid
costs about the same GPU memory as a 20-product one. But every touch-scrollable
`overflow-x` region is composited into a **private, untiled sheet rasterised at its full
scrollable width** — a 12-card rail ≈ 15 MB at 3× DPR, held whether or not it's ever touched.
Vertical scrolling gets memory management for free; horizontal scrollers must be budgeted by
hand. That's what `useRailWindow` is.

## Which tool

| Signal | Tool |
|---|---|
| Jank while JS/layout is busy; cost scales with mounted item count (carousel engines, observers, listeners per item) | `useVirtualization` — CPU |
| Fling stutters with an idle main thread; horizontal scrollers; worse where big layers cluster (near a hero); Layers tab shows fat `overflow-x` rows | `useRailWindow` — GPU |
| A scroll handler (arrows, progress bar, snap logic) reads `scrollWidth`/`clientWidth`/`offsetWidth` every event; jank scales with item count *within one rail*, worse the denser the on-screen layout | `useScrollerWithArrows` — CPU (forced synchronous layout) |
| Same component janky in one page position, smooth in another | Almost certainly GPU — it's the *neighbourhood's* total resident memory, not the component |

**Diagnose in 10 minutes** (Safari → Develop → [iPhone] → page): record a **Timeline** during
the stutter — main thread busy → CPU path; idle → GPU path. Then the **Layers** tab sorted by
memory: ignore layer *count* (tiny link/button layers are noise), read the top rows. Horizontal
scrollers at full scroll width and full-viewport media are where the megabytes live; ≳60–70 MB
resident near one scroll position on a phone is the danger zone.

---

# Tool 1 — `hooks/useRailWindow.ts` (GPU: shrink the drawn area)

For horizontal rails/carousels of cards. Mounts a window of N items (default 6 ≈ 3
phone-screens), expands to the full list on the rail's **own** first scroll event, and
collapses back (rewinding to the start) when the rail leaves the viewport.

```tsx
const { containerRef, visibleCount } = useRailWindow(scrollerNode, products.length, 6);

<section ref={containerRef}>
  <div ref={setScrollerNode} className="no-scrollbar overflow-x-auto">
    {products.slice(0, visibleCount).map((p) => <Card key={p.id} data={p} />)}
  </div>
</section>
```

Why each piece exists (all learned on device, none speculative):

- **Expand on the scroller's own `scroll` event** — fires for touch, wheel and arrow-button
  `scrollBy` alike, never for vertical page scrolling. It fires at gesture *start*, so the
  remaining items mount long before the fling reaches the window's edge: no visible pop-in.
- **Collapse on viewport exit, not never** — without it, a user who swipes every rail leaves
  every strip full-width and the win evaporates (observed: returning to the first rail
  stuttered again). Net invariant: **at most one rail is full-width — the one being touched.**
- **Rewind to 0 on collapse** — re-entry then shows exactly the windowed items. No flash.
- **The expand listener is armed only while on screen** — collapsing a scrolled rail clamps
  its scroll position, and the rewind calls `scrollTo(0)`; both fire `scroll`. Off-screen
  collapse + on-screen-only listener is what prevents an instant re-expand loop.
- **Analytics fire on the full list**, not the rendered slice.

What collapse frees: the out-of-window items' DOM → track shrinks → `scrollWidth` halves →
the layer's bitmap reallocates smaller (the actual GPU saving) → removed `<img>`s free their
decoded bitmaps. What survives: downloaded files (HTTP cache — re-expansion is instant) and
your data/props.

**What does NOT work instead:** virtualizing the cards. Placeholders keep the boxes, the
boxes keep the width, the width is the bill — 15 MB of grey costs exactly 15 MB. Also
pointless: removing images, pausing autoplay, deferring scripts. All content-side; the strip's
*area* is the cost. (Every one of those was tried. See the case study.)

---

# Tool 1b — `hooks/useScrollerWithArrows.ts` (CPU: stop forcing layout in a scroll handler)

Drives the "scroll left/right" arrow buttons + progress-bar state for any horizontal scroller.
Ships the fix for a distinct bug found alongside the GPU one above, on the exact same rails:
the arrow-state handler read `scrollWidth`/`clientWidth` off the scroller **inside its own
scroll event listener**.

Both are layout-dependent reads. If any style/layout work is pending — and mid-fling it always
is (lazy images landing, fade transitions running) — the browser must stop and **synchronously
recompute layout for the whole track** before it can answer. Pay that once per scroll event, on
a scroller with a dense item list, and it adds up: iOS momentum fires `scroll` dozens of times a
second.

```ts
// ❌ Forces a synchronous layout every scroll event
node.addEventListener('scroll', () => {
  const { scrollLeft, clientWidth, scrollWidth } = node; // clientWidth/scrollWidth = layout reads
  ...
});

// ✅ Cache the layout-dependent values; only scrollLeft is read on scroll
let clientWidth = node.clientWidth;
let scrollWidth = node.scrollWidth;
const apply = () => {
  const { scrollLeft } = node; // a scroll OFFSET, not a layout read — always free
  ...
};
const remeasure = () => { clientWidth = node.clientWidth; scrollWidth = node.scrollWidth; apply(); };
node.addEventListener('scroll', apply, { passive: true });
const observer = new ResizeObserver(remeasure);
observer.observe(node);
observer.observe(node.firstElementChild); // see below — required, not optional
```

**Observing the track (not just the scroller) is required, not optional.** The scroller itself
is a fixed-width `overflow-x-auto` box — its own border-box does not change when the content
inside it grows (a card resizing, a breakpoint change, extra items mounting). Node-only
observation would leave the cached `scrollWidth` stale and the arrow's enabled state wrong. The
naive version "got away with" reading fresh every time specifically because it never cached
anything — caching is what makes the track-observer necessary.

This is a **different bug from the GPU one above** — one is a per-event CPU cost (forced
layout), the other is standing GPU memory (the layer's backing store). Fixing one does nothing
for the other; this rail needed both. Distinguish them the same way: a Safari Timeline shows
"Forced Synchronous Layout" entries clustered on scroll for this one, vs an idle main thread
for the GPU one.

---

# Tool 2 — `hooks/useVirtualization.ts` (CPU: viewport-windowed subtree mounting)

Render the expensive part of a list item only while it's near the viewport; swap it for a
same-size placeholder when it's far away. Cuts per-item cost that the browser keeps paying for
as long as an item is *mounted*, regardless of whether it's visible. Extracted from a real
product-grid scroll-jank fix. Opt-in — copy it in only if you've measured that per-item
mounted cost is actually your problem.

## Measure first — cheaper wins usually beat this

In the case this came from, virtualization helped noticeably less than a one-line CSS change did.
Check these before reaching for it:

1. **`backdrop-filter` / `backdrop-blur` on anything repeated.** The compositor re-samples and
   blurs the pixels behind the element *every frame*. In that grid, each card's carousel dots each
   carried `backdrop-blur-sm` (~4-5 dots per card, no `lg:` gate so mobile too). At 1 column ≈ 9
   live blur layers on screen; at 2 columns ≈ 25-30. Same product count — the denser layout just
   packs 3× more blur layers into each scroll frame, which is exactly what "2-col feels choppier
   than 1-col" was. At a 6px dot the blur is invisible anyway. Deleting it beat virtualization.
2. **Layout reads in scroll handlers.** Reading `scrollWidth`/`clientWidth`/`offsetWidth` in a
   scroll handler forces a synchronous layout of the content whenever style/layout work is
   pending — mid-scroll it always is. Cache them and refresh from a `ResizeObserver` that
   observes the **content/track**, not just the scroller (a fixed-width scroller's own box
   doesn't change when its content grows, so node-only observation goes stale).
3. **Are offscreen images actually downloading?** If images use native `loading="lazy"` (Next's
   `Image` does for anything without `priority`), they already aren't. Virtualization will *not*
   improve image bandwidth — see "What this reclaims" below.
4. **Shadows, filters, `will-change`, and transitions on repeated items** — same class of
   per-instance compositing cost, same question: does it scale with items on screen?

The tell for a *mounted-cost* problem (which this does fix) is that scroll gets worse as **on-screen
item density** rises — more columns, shorter rows — even though the total item count is unchanged.

## When it fits

Per-item cost the browser pays continuously while mounted:

- carousel/slider engines (Embla, Swiper) — each one typically owns a `ResizeObserver` plus
  pointer/drag listeners
- per-item observers (`IntersectionObserver`, `ResizeObserver`)
- decoded image bitmaps
- heavy DOM subtrees (a 5-slide carousel per card = 5× the nodes)

## When it doesn't

- **Short lists.** The observer per item isn't free; below ~20 items you're adding cost.
- **Text-only / cheap items.** Nothing to reclaim.
- **The item must be in the server HTML** — SEO-critical content, or anything above the fold. Gate
  those out explicitly (see the `priority` escape hatch).
- **Single-cheap-subtree items in a horizontal rail.** A one-image card has no engine, no
  observers, nothing to reclaim — and `rootMargin` applies to every edge, so cards swap
  placeholder→real *sideways mid-fling*, forcing a re-decode exactly when it hurts. Gate the
  hook off (`enabled=false`) for those. GPU memory is unaffected either way (see Tool 1).

## The three pieces

Keeping these labelled matters — someone landing in the consumer needs to find the hook, and vice
versa. Number them in comments.

### 1. The detector — `hooks/useVirtualization.ts`

The only thing that decides "near or far". `IntersectionObserver` with a `rootMargin` buffer.
`shouldRender` flips **both** ways — that two-way toggle is what makes it virtualization rather
than a one-shot "has it been seen yet" gate. Takes an `enabled` flag: when false, no observer is
ever created and `shouldRender` derives to true (derived, not seeded into state — a mounted item
whose `enabled` later flips false must immediately render real, not stay stuck on its placeholder).

### 2. The decision — in the consumer

```tsx
const { ref: nearRef, shouldRender } = useVirtualization<HTMLDivElement>(hasSomethingToReclaim);
// priority = the above-the-fold set: never virtualized, so the server HTML keeps
// a real <img> for the LCP element and for indexing.
const isReal = priority || shouldRender;
```

### 3. The swap — the line that frees the memory

```tsx
// ref is on the OUTER div: it must stay mounted in BOTH branches.
<div className="group relative overflow-hidden" ref={nearRef}>
  {isReal ? (
    <>{/* the real thing: carousel engine, slides, images, dots, arrows */}</>
  ) : (
    // Same box as the real subtree, so nothing shifts when it swaps back.
    <div className={`${aspect} w-full bg-surface-muted`} aria-hidden="true" />
  )}
</div>
```

If the subtree contains a library instance, also pass the flag into that library's own "off"
switch where one exists (Embla: `active: hasMultiple && isReal`). The unmount already tears it
down; this just keeps it dormant on renders where the real markup isn't shown at all.

## Three rules you cannot break

1. **The ref goes on an element that stays mounted in both branches.** Put it inside the
   conditional subtree and the observer loses its target the moment the item virtualizes out — it
   can then never flip back, so the item stays a grey box forever.
2. **The placeholder must occupy the same box** (aspect ratio / height) as the real subtree.
   Otherwise the page height changes on every swap and the scroll position jumps under the user.
3. **Reset any state that describes the unmounted subtree.** State lives on the outer component, so
   it *survives* a virtualization round-trip while the subtree does not — and a rebuilt library
   instance starts from scratch. Shipped as a bug: a carousel swiped to slide 3, scrolled away, then
   scrolled back showed slide 0 while the dots still pointed at 3 and the arrows stepped from the
   wrong origin. Clear it alongside the teardown:

   ```tsx
   useEffect(() => {
     if (!shouldRender) setCurrent(0);
   }, [shouldRender]);
   ```

   **Do not instead feed the remembered value back as a library option** (`startIndex`, `initialSlide`
   …). Many wrappers re-initialise whenever their options change — `embla-carousel-react` calls
   `reInit()` on any option diff — so a value that updates on every interaction rebuilds the engine
   on every interaction. That's worse than the desync you're fixing.

## What this reclaims — and what it doesn't

**Does:** library instances and their observers/listeners, the subtree's DOM nodes, decoded image
bitmaps.

**Does not:** image *downloads* (native `loading="lazy"` already prevents those), and — the big
one — **GPU layer memory of a fixed-size container**. The placeholder keeps the box; the box
keeps the drawn area; the area is the GPU bill. If the Layers tab shows fat scroller rows, you
need Tool 1, not this.

**Don't double-gate inside the window.** Once virtualization bounds how many items are mounted, a
second gate limiting content *within* a mounted item is usually solving a problem the window already
solved — and it costs a visible placeholder step on first interaction. We shipped exactly that (a
"load one image ahead, the rest on first swipe" counter inside each card) and removed it: the window
was already the real bound, and the gate just meant every card's first swipe revealed a grey box.

But be honest about the arithmetic, because "the window makes it free" is wrong: **the window bounds
items, not content per item.** Dropping an inner gate on ~16 mounted cards averaging ~4.4 images each
means ~70 `<img>` in the DOM instead of ~32. They stay `loading="lazy"`, but carousel slides sit
inside the viewport's geometric bounds (only clipped by `overflow-hidden`) and browsers largely
ignore ancestor clipping when deciding to fetch — so expect closer to a 2× rise in requests near the
viewport. Right trade if the jank is compositing; wrong one if it's network/decode. If it regresses,
tighten `rootMargin` rather than reinstating the inner gate.

**Survives the swap:** the downloaded file stays in the browser's own HTTP cache, which is why
scrolling back re-mounts near-instantly despite a genuine teardown. Three separate layers: DOM +
engine (freed), decoded bitmap (freed), encoded file in cache (kept, not yours to control).

**Lost on the swap:** transient in-subtree state. A carousel scrolled to image 3 comes back on
image 1. Acceptable for a grid; not for something holding user input.

## SEO tradeoff — decide it consciously

`shouldRender` is false during SSR and until the observer fires, so **whatever you virtualize is
absent from the initial HTML.** Scope that deliberately:

- Virtualizing only the *media* area of a card, while its title/price/link stay mounted, keeps
  every item's URL crawlable — the images just may not be indexed for image search.
- Virtualizing a whole item removes its link from the server HTML too. Materially bigger decision.
- Either way, exempt the above-the-fold set via `priority` so the LCP element is real on first
  paint.

## Tuning `rootMargin`

The pre-render buffer, and a pure feel-vs-cost knob:

- **Bigger** — the real subtree is ready before you reach it (no placeholder flashes), but more
  instances stay alive at once, so less of the win.
- **Smaller** — cheaper, but a fast scroll can out-run it and you'll see grey boxes.

`800px` ≈ 2-3 rows of a mobile product grid ≈ ~16 live items. Tune on a real mid-range device;
don't guess from a desktop browser.

## Browser-native alternative

`content-visibility: auto` + `contain-intrinsic-size` lets the engine skip layout *and* paint for
offscreen subtrees with no JS at all, and will generally beat this hook. Caveat that decided it
here: Safari only shipped it in 18, so on older iOS — often exactly the devices you're debugging
jank on — it silently no-ops. Worth an A/B with a real profile, not a blind swap.
