# Image fit strategy — object-cover vs object-contain vs CMS aspect ratio

Decides how an image's box is sized and how the image fills it. Distinct from the
`image-optimization` skill (which tunes `width`/`sizes`/`quality` for performance) —
this rule decides the *shape* strategy, before performance tuning even applies.

## The decision, in two questions

**1. Must this image share a box shape with siblings, or is it a curated asset shot to spec?**
(Product cards, category cards, any repeating card layout — plus heroes and banners)

→ **Fixed aspect ratio + `object-cover`.** Every card gets an identical box regardless
of what photo lands in each slot. A slight crop is the expected, accepted tradeoff for
uniform grid alignment — a mismatched box height in one card breaks the whole row.
Set the ratio separately per breakpoint when the design changes shape.

```tsx
<div className="relative aspect-[328/236] w-full overflow-hidden lg:aspect-[500/328]">
  <Img className="h-full w-full object-cover" ... />
</div>
```

**This is the default.** Reach for question 2 only when a standalone image genuinely
must not be cropped and has no siblings to align with.

**2. Is this a standalone editorial image that must show 100% of the photo?**
(A one-off documentary photo, a diagram, a screenshot — no sibling grid to stay aligned with)

→ **Derive the box's aspect ratio from the CMS media's own `width`/`height`.** The box
*becomes* the photo's shape, so nothing is cropped and nothing is letterboxed.

```tsx
<div
  className="aspect-[var(--ar)] w-full max-w-[640px] overflow-hidden"
  style={{
    // Fallback ratio only applies when the CMS metadata is missing.
    '--ar': data.media?.width && data.media?.height
      ? `${data.media.width} / ${data.media.height}`
      : '640 / 520',
  } as CSSProperties}
>
  <Img className="h-full w-full object-cover" ... />
</div>
```

### Use `object-cover` here too — `contain` buys nothing

Once the box's ratio equals the image's ratio, `object-cover` and `object-contain`
render **identically**: contain fits inside preserving ratio, cover fills preserving
ratio, and with matching ratios both are an exact fill. The object-fit value only has
an observable effect in the **fallback branch** (CMS `width`/`height` null → hardcoded
ratio), and there `cover` degrades to a mild crop while `contain` degrades to visible
empty bars. So `cover` is strictly the better default in this case, not a compromise.

### Cap size on the driving dimension only — never both axes

`aspect-ratio` sizes only the **auto** dimension. If you give a box a definite width
*and* a `max-height`, a binding `max-height` clamps the height while the width stays —
the rendered box ratio now diverges from the declared one, and the image letterboxes
(or crops) exactly when the cap engages. Cap the driving dimension and leave the other
`auto` so the ratio recomputes:

```tsx
// ✅ width-driven — cap width, height follows the ratio
className="aspect-[var(--ar)] w-full max-w-[640px] overflow-hidden"

// ✅ height-driven — cap height, width follows the ratio
className="h-full max-h-10 w-auto max-w-full object-contain"

// ❌ definite width + max-height — breaks the ratio the moment the cap binds,
//    reintroducing the letterboxing this whole case exists to avoid
className="aspect-[var(--ar)] w-full max-h-[183px] overflow-hidden"
```

Past a cap you must choose bars or a crop — there is no third option. Don't reach for
`contain` expecting one.

## Heroes, banners, and carousels are question 1, not question 2

Hero/banner components are **curated, art-directed marketing assets** — content teams
prep exact-ratio crops before upload, the same way product photography is shot to spec.
**Fixed design ratio + `object-cover`**, never CMS-derived. A hero with visible
letterboxing looks broken; a controlled crop does not.

```tsx
// hero — fixed ratio, not CMS-derived
style={{ '--ar-mobile': '18 / 25', '--ar-desktop': '21 / 10' }}
className="aspect-[var(--ar-mobile)] lg:aspect-[var(--ar-desktop)] object-cover max-h-svh"
```

If a banner crops badly in practice, the fix is **not** switching to CMS ratio —
document the required ratio for the content team and/or add a crop preview in the CMS,
so uploads match the box in the first place.

## Why `object-cover` is usually enough

`object-cover` is a safety net, not the primary cropping mechanism. If editors upload
images already matching the box's ratio, `cover` never visibly crops anything — it only
engages when an upload doesn't match. This is why question 1 doesn't need CMS-derived
ratios: the box shape is a *contract* with the content team, not something the code
needs to discover per-image.

## The one real use for `object-contain`

`contain` earns its place only when the box's ratio **cannot** match the image's and
the whole image must still be visible — a uniform row/grid of assets with wildly
varying native ratios, where empty space reads as intentional padding rather than
letterboxing. Logo strips are the canonical case: fixed height, `w-auto`, `contain`.
Transparent logo backgrounds make the leftover space invisible.

Outside that shape, prefer `cover`.
