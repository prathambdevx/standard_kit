# Case study — one symptom, two diseases: iOS scroll jank on a real storefront

> How the same "scrolling feels choppy on iPhone" showed up twice in one project — a vertical
> collection grid and a set of horizontal product rails — with completely different causes.
> Kept here in full because the *diagnosis journey* is the lesson: six plausible theories died
> on device evidence before a one-minute Layers-tab measurement found the truth. File paths
> refer to the source project (a Next.js storefront); the reusable hooks live next to this doc.

---

## TL;DR

| Where | Symptom | Real cause | Fix |
|---|---|---|---|
| PLP, 2-column mobile grid | vertical page scroll choppy | **CPU/compositor work per frame**: `backdrop-blur` on every carousel dot, layout reads in scroll handlers, a live carousel engine per card | remove the blur, cache the layout reads, virtualize card subtrees (`useVirtualization`) |
| Homepage product rails | horizontal fling choppy — **only the rail in first position** | **GPU memory**: five horizontal scrollers each hold a full-width pre-drawn strip (~15 MB each); stacked near the hero they exceed what the phone can hold, so iOS evicts and redraws tiles mid-fling | window each rail to 6 cards; expand on the rail's own first scroll; collapse again when it leaves the viewport (`ProductRail`) |

The confusing part: **both present as "scroll is choppy on iOS".** The organ under load is
different, and every tool that helps one does nothing for the other. We burned six wrong
theories on the rails because we kept treating a GPU problem with CPU tools.

---

## The mental model: the thinking side and the drawing side

A phone renders a page with two workers:

**The CPU — the thinking side.** Runs your JavaScript, builds DOM nodes, computes layout
("where does everything go"), decodes image files, runs observers and event listeners.
Its cost scales with **how many live things exist**. CPU trouble feels like jank when things
*happen* — a tap responds late, a re-render stutters.

**The GPU — the drawing side.** Holds finished, pre-drawn pictures of page content ("layers")
and blends them into each frame. Its cost scales with **how much pre-drawn area must be held
at once** — a layer's memory is `width × height × 4 bytes`, and the *content is irrelevant*:
a grey box costs exactly what a product photo costs. GPU trouble feels like jank while things
merely *move* — a fling stutters **while the main thread is idle**.

One-liner: **CPU pays for what exists; GPU pays for what's drawn. Virtualization removes what
exists inside a fixed area; windowing shrinks the area.**

---

## The asymmetry that decided everything: vertical vs horizontal scrolling

This is the single most useful fact in this doc.

**Vertical content (the page itself) is auto-managed.** The document's base layer is cut into
small **tiles**, and the browser keeps only the tiles near your current scroll position —
scroll on, and tiles behind you are dropped automatically. That's why the homepage's
`#document` layer measured ~22 MB and not 300 MB, and why a PLP with 200 products costs about
the same GPU memory as one with 20. You get tile eviction for free, forever, in the vertical
direction.

**A horizontal scroller (`overflow-x: auto`) gets a private, untiled sheet.** iOS composites
every touch-scrollable overflow region into its own layer so it can scroll off the main
thread — and that layer's backing store is rasterised at its **full scrollable width**. A
12-card rail ≈ 2,400 CSS px wide ≈ **15.7 MB at 3× DPR** (measured, see below), held whether
or not the user ever scrolls it.

So: one long vertical grid never blows up the GPU. Five horizontal rails stacked near a hero
absolutely can.

---

## Case study A — the PLP grid (a CPU-side problem)

Symptom: the 2-column mobile grid scrolled noticeably worse than 1-column. Same products,
same images — only the on-screen *density* changed. That's the tell for per-instance mounted
cost, not data cost.

Three separate causes, three fixes:

1. **`backdrop-blur` on every carousel dot.** Each card's image dots carried
   `backdrop-blur-sm`. A backdrop filter makes the compositor re-sample and blur the pixels
   behind the element **every frame**. ~4–5 dots per card × the cards on screen — 2-column
   packs ~3× more blur layers into every scroll frame than 1-column. At a 6px dot the blur is
   invisible anyway. **Deleting it was the single biggest win.**

2. **Layout reads inside scroll handlers.** `useScrollerWithArrows` read
   `scrollWidth`/`clientWidth` off the node on every scroll event. Those are layout-dependent
   reads: if any style/layout work is pending (mid-scroll it always is — lazy images landing,
   fades running), the browser must stop and synchronously re-lay-out the whole track before
   answering. Fixed by caching both values and refreshing them only from a `ResizeObserver`
   (which must observe the **track**, not just the scroller — the scroller's own box doesn't
   change when its content grows).

3. **A live carousel engine per card.** Every multi-image card ran an Embla instance
   (ResizeObserver + drag listeners) and full slide DOM the whole time it was mounted, however
   far below the fold. Fixed with `useVirtualization` (`hooks/useVirtualization.ts` (kit copy alongside this doc)):
   an IntersectionObserver window that swaps far-away card subtrees for same-size placeholders
   and swaps them back near the viewport.

**Why virtualization was right here:** the costs were all *machinery* — engines, listeners,
DOM. Unmounting the subtree reclaims them. The placeholder keeps the card's box, so the page
doesn't jump — and that's fine, because the box's drawn area was never the problem.

---

## Case study B — the homepage rails (a GPU-side problem)

Symptom: flinging a product rail sideways stuttered — but **only whichever rail sat in first
position**. Move rail 3 to position 1 in the CMS and *it* became the laggy one. PDP rails,
same component, same 12 products: always smooth.

### What we ruled out (and why each could never have worked, in hindsight)

Every one of these was tested on device and changed nothing:

| Theory | Why it was doomed |
|---|---|
| Image download/decode (tested: all images commented out) | grey pixels cost the GPU exactly what photo pixels cost — the strip is the same size |
| Card count / payload size | rails had 10–12 products either way; layer size is what mattered |
| Carousel autoplay (CMS off) | the strip exists whether or not it animates |
| Hero video (CMS hidden) | same — content of a layer, not area |
| Hero slide count (1 slide) | same |
| Third-party scripts / mount timing | main thread was idle during the stutter |
| `transition-all` on Alink/Button bases | removed hundreds of layers — all 25–58 **KB** trinkets; memory stayed at 93 MB |

The pattern: all CPU-side or content-side levers. None shrank a strip.

### The measurement that ended it

Safari Web Inspector → **Layers** tab (phone over USB), sorted by memory:

```
#document                              21.73 MB   ← the page's own tiled layer
div.no-scrollbar.overflow-x-auto…      15.70 MB   ← a product rail, full scroll width
div.no-scrollbar.overflow-x-auto…      15.70 MB   ← another rail
div.no-scrollbar.overflow-x-auto…       9.44 MB   ← more horizontal scrollers
div.no-scrollbar.overflow-x-auto…       8.37 MB
div.no-scrollbar.overflow-x-auto…       7.85 MB
everything else (500+ layers)          ~2 MB combined
──────────────────────────────────────────────
Layer count: 525          Memory: ~93 MB
```

Five horizontal scrollers ≈ 57 MB, plus the base page ≈ 22 MB → **~80 MB that must be resident
simultaneously when standing at the first rail.** Over the phone's comfortable budget → iOS
evicts tiles it still needs and re-rasterises them mid-fling → stutter, with the main thread
idle.

### Why only the first rail

The phone keeps pre-drawn pictures only for content **near your current scroll position**.

- **At rail 1**, "near" includes the heaviest things on the whole page: the hero, the
  collection strip, the featured banner — plus rails 2 and 3 directly below. Everything must
  be held at once. The desk overflows.
- **At rail 3**, the hero and strip are two screens away — already dropped. What's near you
  fits. Smooth.

Same rail, same strip size — different neighbours. **It's the seat, not the rail.** That's
why the CMS swap moved the lag to whichever rail sat first, and why PDP rails (separated by
paragraphs of product info, so never more than one rail in range) were always fine.

### The fix: windowing (`ProductRail`)

Virtualization cannot help here — placeholders keep the boxes, the boxes keep the width, the
width *is* the bill. The boxes themselves have to go:

1. **Mount 6 cards** per rail (~3 phone-screens of runway). Strip: ~15.7 MB → ~8 MB.
2. **Expand to the full list on the rail's own first `scroll` event** — fires for touch,
   wheel and the arrows' `scrollBy` alike, and never for vertical page scrolling. Expansion
   happens at gesture start, so cards 7–12 exist before the fling reaches card 6: no visible
   pop-in, and appending on the right can't shift what's on screen.
3. **Collapse back to 6 when the rail leaves the viewport**, rewinding `scrollLeft` to 0.
   Without this, swiping all three rails to the end leaves every strip full-width again and
   returning to rail 1 stutters exactly like before (observed on device). Collapsing off
   screen + rewinding means the user always re-enters a rail at its start, where the 6 mounted
   cards are precisely the ones in view — **no grey flash, ever**.

The subtle bug this design avoids: collapsing a scrolled rail makes the browser clamp its
scroll position, and the rewind calls `scrollTo(0)` — both fire the very `scroll` event that
triggers expansion. Guard: the expand listener is only attached **while the rail is on screen**
(a two-way `useInView`), and collapse only happens off screen, so its scroll events land on no
listener.

Net effect: **at any moment, at most one rail is full-width — the one being touched.** Which
is exactly the state a PDP is in naturally.

What collapse tears down / keeps:

- torn down: cards 7–12's DOM → track shrinks → `scrollWidth` halves → WebKit reallocates the
  strip bitmap at the smaller size (the actual GPU saving) → the removed `<img>`s also free
  their decoded bitmaps
- kept: downloaded image files (HTTP cache — re-expansion is instant), the full `products`
  array (props), analytics (impressions fire on the full list, independent of the rendered
  slice)

---

## How to diagnose the next one (10 minutes, not 6 theories)

1. **First question: is the main thread busy while it stutters?**
   Safari on Mac → Develop → [iPhone] → page → **Timelines**, record a fling.
   - Layout/JS packed during the stutter → CPU problem → look for layout reads in scroll
     handlers, per-frame effects, too much live machinery.
   - Main thread idle but it still stutters → GPU problem → go to step 2.
2. **Layers tab, sorted by memory.** Ignore the layer *count* (hundreds of tiny link/button
   layers are noise) — read the **top rows**. Horizontal scrollers at full scroll width and
   full-viewport media are where the megabytes are. Total ≳ 60–70 MB near one scroll position
   on a phone is the danger zone.
3. **The positional tell.** If the same component is janky in one page position and smooth in
   another, it's almost never the component — it's the total resident memory of that
   *neighbourhood*.

---

## Rules of thumb

- `width × height × 4 bytes` — content irrelevant. Hiding images inside a fixed-size layer
  saves nothing.
- Vertical page content: tiled and auto-evicted, effectively free at any length. Horizontal
  scrollers: private full-width sheets — budget them, window them.
- Virtualization = CPU tool (engines, listeners, DOM). Windowing = GPU tool (drawn area).
  Matching the tool to the organ is the whole game.
- `backdrop-filter` on repeated elements is a per-frame compositor tax that scales with
  on-screen density.
- Never read `scrollWidth`/`clientWidth`/`offsetWidth` in a scroll handler; cache + refresh
  from a `ResizeObserver` that observes the content, not just the scroller.
- Don't trust a plausible theory over a measurement. The Layers screenshot found in one
  minute what six code-reading theories missed.
