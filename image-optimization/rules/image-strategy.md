# Image fit strategy — object-cover vs object-contain vs CMS aspect ratio

Decides how an image's box is sized and how the image fills it. Distinct from the
`image-optimization` skill (which tunes `width`/`sizes`/`quality` for performance) —
this rule decides the *shape* strategy, before performance tuning even applies.

## The decision, in two questions

**1. Is this image one of several siblings in a grid/row that must all look the same size?**
(Product cards, category cards, any repeating card layout)

→ **Fixed aspect ratio + `object-cover`.** Every card gets an identical box regardless
of what photo lands in each slot. A slight crop is the expected, accepted tradeoff for
uniform grid alignment — a mismatched box height in one card breaks the whole row.

```tsx
<div className="relative aspect-[328/236] w-full overflow-hidden lg:aspect-[500/328]">
  <Img className="h-full w-full object-cover" ... />
</div>
```

**2. Is this a standalone image where showing 100% of the photo matters more than a uniform box?**
(One-off editorial/documentary content — a diagram, a screenshot, a single feature photo —
where cropping would lose something meaningful, and there's no sibling grid to stay aligned with)

→ **CMS-derived aspect ratio + `object-contain`**, always paired with a max-height/width
cap (mobile *and* desktop values, set separately) so one extreme upload can't blow out
the layout.

```tsx
const ratio = data.media?.width && data.media?.height
  ? `${data.media.width} / ${data.media.height}`
  : '996 / 664'; // fallback ratio when the CMS field is empty

<div
  style={{ aspectRatio: ratio }}
  className="relative max-w-full max-h-[183px] overflow-hidden lg:max-w-[70vw] lg:max-h-[664px]"
>
  <Img className="h-full w-full object-contain" ... />
</div>
```

`max-w`/`max-h` are both **caps**, not fixed sizes — set each one separately for mobile
(`max-w-*`, `max-h-*`) and desktop (`lg:max-w-*`, `lg:max-h-*`). Never use a plain `w-*`/`h-*`
here — a fixed width would fight the aspect-ratio-derived box instead of letting it size to
the actual photo, up to the cap.

## Default: banners, heroes, and carousels are case 1, not case 2

Hero/banner components are **curated, art-directed marketing assets** — content teams are
expected to prep exact-ratio crops before upload, the same way product photography is shot
to spec. Treat them like grid case 1: **fixed design ratio + `object-cover`**, never
CMS-derived ratio. A hero with visible letterboxing (empty bars from a mismatched upload)
looks broken; a controlled crop does not.

```tsx
// hero — fixed ratio, not CMS-derived
style={{ '--ar-mobile': '18 / 25', '--ar-desktop': '21 / 10' }}
className="aspect-[var(--ar-mobile)] lg:aspect-[var(--ar-desktop)] object-cover max-h-svh"
```

If a banner is visibly cropping badly in practice, the fix is **not** switching to
CMS-ratio + `contain` — document the required ratio for the content team and/or add a
crop preview in the CMS, so uploads match the box in the first place.

## Why `object-cover` alone is usually enough

`object-cover` is a safety net, not the primary cropping mechanism. If editors upload
images already matching the box's ratio, `cover` never visibly crops anything — it only
kicks in when an upload doesn't match. This is why case 1 doesn't need CMS-derived ratios:
the box shape is a *contract* with the content team, not something the code needs to
discover per-image.

## Why a fixed ratio + `object-contain` isn't "good enough" for case 2

`object-contain` alone (with a fixed, generic box ratio) already prevents cropping — but
it does nothing about **letterboxing**. Any photo whose native ratio doesn't exactly match
the fixed box ratio gets empty bars on one axis, and the size/side of that gap is
unpredictable across different uploads. Deriving the box's own aspect ratio from the CMS
media makes the box *become* the photo's shape, so `object-contain` never has anything left
to letterbox.

## Always cap the CMS-ratio case

An extreme aspect ratio (very tall portrait, ultra-wide panorama) with no cap can balloon
the box far beyond intended size. Always pair CMS-derived ratio with `max-h-*`/`max-w-*`
set for mobile and desktop separately, per the reference implementation above.
