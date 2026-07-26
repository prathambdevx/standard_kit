# optional/

Patterns that are **not** part of the default setup. Each solves a real, measured problem but
carries a tradeoff you have to accept deliberately — so nothing here is copied in by default.

Distinct from `extras/`: that folder holds optional *enhancements* lifted out of `ui-components/`
(nice-to-have behaviour, low risk). This folder holds patterns with a genuine **cost or downside**
to weigh — SEO impact, lost state, added complexity — which is why each one leads with when *not*
to use it.

| Pattern | Solves | Accept in exchange |
|---|---|---|
| **`list-virtualization/`** | Long-list scroll jank caused by per-item cost the browser pays while an item is *mounted* (carousel engines, per-item observers, heavy DOM, decoded bitmaps) | Virtualized content is absent from the server HTML (SEO), transient in-subtree state resets on swap, and one observer per item is added |

## Before copying anything in here

Measure. Each doc opens with the cheaper wins that commonly beat it — in the case
`list-virtualization` came from, deleting a `backdrop-filter` from a repeated element helped more
than the virtualization did. These are last resorts, not defaults.
