# List virtualization (viewport-windowed subtree mounting)

Render the expensive part of a list item only while it's near the viewport; swap it for a
same-size placeholder when it's far away. Cuts per-item cost that the browser keeps paying for
as long as an item is *mounted*, regardless of whether it's visible.

Extracted from a real product-grid scroll-jank fix. Opt-in — copy it in only if you've measured
that per-item mounted cost is actually your problem.

---

## Measure first — cheaper wins usually beat this

In the case this came from, virtualization helped noticeably less than a one-line CSS change did.
Check these before reaching for it:

1. **`backdrop-filter` / `backdrop-blur` on anything repeated.** The compositor re-samples and
   blurs the pixels behind the element *every frame*. In that grid, each card's carousel dots each
   carried `backdrop-blur-sm` (~4-5 dots per card, no `lg:` gate so mobile too). At 1 column ≈ 9
   live blur layers on screen; at 2 columns ≈ 25-30. Same product count — the denser layout just
   packs 3× more blur layers into each scroll frame, which is exactly what "2-col feels choppier
   than 1-col" was. At a 6px dot the blur is invisible anyway. Deleting it beat virtualization.
2. **Are offscreen images actually downloading?** If images use native `loading="lazy"` (Next's
   `Image` does for anything without `priority`), they already aren't. Virtualization will *not*
   improve image bandwidth — see "What this reclaims" below.
3. **Shadows, filters, `will-change`, and transitions on repeated items** — same class of
   per-instance compositing cost, same question: does it scale with items on screen?

The tell for a *mounted-cost* problem (which this does fix) is that scroll gets worse as **on-screen
item density** rises — more columns, shorter rows — even though the total item count is unchanged.

---

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

---

## The three pieces

Keeping these labelled matters — someone landing in the consumer needs to find the hook, and vice
versa. Number them in comments.

### 1. The detector — `hooks/useVirtualization.ts`

The only thing that decides "near or far". `IntersectionObserver` with a `rootMargin` buffer.
`shouldRender` flips **both** ways — that two-way toggle is what makes it virtualization rather
than a one-shot "has it been seen yet" gate.

### 2. The decision — in the consumer

```tsx
const { ref: nearRef, shouldRender } = useVirtualization<HTMLDivElement>();
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

---

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

---

## What this reclaims — and what it doesn't

**Does:** library instances and their observers/listeners, the subtree's DOM nodes, decoded image
bitmaps.

**Does not:** image *downloads*, on its own. Native `loading="lazy"` already prevents offscreen
images from being fetched without removing them from the DOM. Be precise about this when justifying
the change — it's easy to over-claim. What the window *does* give you is a **bound**: see below.

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

---

## SEO tradeoff — decide it consciously

`shouldRender` is false during SSR and until the observer fires, so **whatever you virtualize is
absent from the initial HTML.** Scope that deliberately:

- Virtualizing only the *media* area of a card, while its title/price/link stay mounted, keeps
  every item's URL crawlable — the images just may not be indexed for image search.
- Virtualizing a whole item removes its link from the server HTML too. Materially bigger decision.
- Either way, exempt the above-the-fold set via `priority` so the LCP element is real on first
  paint.

---

## Tuning `rootMargin`

The pre-render buffer, and a pure feel-vs-cost knob:

- **Bigger** — the real subtree is ready before you reach it (no placeholder flashes), but more
  instances stay alive at once, so less of the win.
- **Smaller** — cheaper, but a fast scroll can out-run it and you'll see grey boxes.

`800px` ≈ 2-3 rows of a mobile product grid ≈ ~16 live items. Tune on a real mid-range device;
don't guess from a desktop browser.

---

## Browser-native alternative

`content-visibility: auto` + `contain-intrinsic-size` lets the engine skip layout *and* paint for
offscreen subtrees with no JS at all, and will generally beat this hook. Caveat that decided it
here: Safari only shipped it in 18, so on older iOS — often exactly the devices you're debugging
jank on — it silently no-ops. Worth an A/B with a real profile, not a blind swap.
