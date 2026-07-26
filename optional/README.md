# optional/

Patterns that are **not** part of the default setup. Each solves a real, measured problem but
carries a tradeoff you have to accept deliberately — so nothing here is copied in by default.

Distinct from `extras/`: that folder holds optional *enhancements* lifted out of `ui-components/`
(nice-to-have behaviour, low risk). This folder holds patterns with a genuine **cost or downside**
to weigh — SEO impact, lost state, added complexity — which is why each one leads with when *not*
to use it.

| Pattern | Solves | Accept in exchange |
|---|---|---|
| **`virtualization/`** — `useVirtualization` (CPU) | Long-list scroll jank caused by per-item cost the browser pays while an item is *mounted* (carousel engines, per-item observers, heavy DOM, decoded bitmaps) | Virtualized content is absent from the server HTML (SEO), transient in-subtree state resets on swap, and one observer per item is added |
| **`virtualization/`** — `useRailWindow` (GPU) | Horizontal-rail fling jank on iOS with an **idle main thread**: every `overflow-x` scroller holds a private layer rasterised at its full scroll width (~15 MB per 12-card rail at 3×), and several stacked near a hero exceed the phone's GPU budget → tile eviction mid-fling | Items beyond the window are absent from the server HTML; a rail collapses + rewinds to its start when it leaves the viewport |

The folder README opens with the CPU-vs-GPU model and a decision table for which of the two
tools your jank actually needs — they are **not interchangeable** (a placeholder keeps the box,
the box keeps the drawn area, so virtualization saves zero GPU memory). `case-study.md` in the
same folder is the full real-world diagnosis story, including the six theories that died before
the Layers-tab measurement found it.

## Before copying anything in here

Measure. Each doc opens with the cheaper wins that commonly beat it — in the case the
virtualization hook came from, deleting a `backdrop-filter` from a repeated element helped more
than the virtualization did. And record a Safari Timeline before choosing a tool: main thread
busy during the stutter → CPU path; idle → GPU path. These are last resorts, not defaults.
