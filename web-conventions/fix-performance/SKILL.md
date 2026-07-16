---
name: fix-performance
description: Apply known performance rules to the codebase. Audits and fixes LCP, CLS, INP, bundle, and TanStack Query patterns. Does NOT run Lighthouse — that's manual.
user-invocable: true
---

# /fix-performance — Apply Perf Rules

Codifies the perf playbook into an auto-applicable rule pass. **Does not run Lighthouse** —
the developer runs that manually before/after to measure impact.

## When to invoke

- After scaffolding a new page (catches missing `priority`, `width`/`height`, bad `sizes`)
- Before a milestone perf pass (apply rules across the codebase)
- After a Lighthouse run flags an issue (apply the relevant rule to the offending file)

## Rules applied

### LCP
- Hero / above-the-fold `<Img>` / `<Picture>` has `priority` prop set
- `sizes` attribute set to match rendered widths per breakpoint (e.g. `(min-width: 768px) 50vw, 100vw`)
- `width` and `height` reflect rendered CSS size (the 2x DPR loader handles upscaling)
- Fonts loaded via `next/font` with `display: 'swap'`
- `preconnect` set for image CDN, Shopify CDN, Strapi
- Server Components by default; client-component boundary pushed as deep as possible
- No client-side data fetching on the LCP path — pre-fetch in RSC and pass as props

### CLS
- Every `<Img>` / `<img>` has explicit `width` + `height`
- Reserved space (min-height) for ad slots, embeds, late-mounting widgets
- Font fallback uses `size-adjust` (via `next/font` fallback metrics) to prevent reflow on swap

### INP
- Heavy third-party scripts via `@next/third-parties` (GTM, Meta Pixel)
- Long lists virtualised or paginated
- Event handlers that do > 50ms work wrapped in `startTransition`
- `useMemo` / `useCallback` only where profiler shows benefit (flag gratuitous ones)

### Bundle
- No barrel imports of large libs (`import { x } from 'lodash'` not `from 'lodash'`)
- Dynamic-import non-critical client components (`next/dynamic`)
- Defer 3rd-party scripts until after interactive
- Conditional code paths code-split

### TanStack Query
- Seed `initialData` on infinite queries to skip page-0 refetch on hydration
- Set `staleTime` consciously per query type
- Prefetch in RSC + dehydrate when applicable
- All client fetches go through `useApiQuery` / `useApiMutation` (never raw `useQuery`)

### Images (delegates to `image-optimization` skill)
- 2x DPR loader on `Img`/`Picture` enforced
- Quality 50–75 per use case (hero 70–75, product 65–75, thumbnails 50–60)
- `sizes` matches breakpoints

## Flow

1. **Scope.** If invoked with a file argument, audit that file only. Otherwise audit
   files changed since last commit. Optionally accept a route segment to audit a section.
2. **Audit each rule** with file:line precision.
3. **Apply auto-fixable changes** in-place:
   - Add missing `width`/`height` to images (infer from class names or use a sensible default)
   - Add `priority` to detected LCP images (first `<Img>` above the fold)
   - Rewrite barrel imports (`from 'lodash'` → `from 'lodash/get'`)
   - Migrate `<Script>` for analytics to `@next/third-parties`
4. **Flag changes that need review** (suspected unnecessary `useMemo`, virtualisation candidates).
5. **Run `bun run typecheck`** after edits; don't claim done until green.
6. **Report** what was changed, what was flagged.

## What this skill does NOT do

- Doesn't run Lighthouse or any browser
- Doesn't measure perf scores
- Doesn't replace real-user monitoring (RUM)
- Doesn't auto-fix things that need design judgment (e.g. "which image is the LCP?")

## Output

```
Performance Rule Pass — 5 files audited

✓ Fixed (3)
  apps/web/src/app/products/[handle]/page.tsx:12
    Added priority + sizes to hero Img

  apps/web/src/components/Section/HomeHero.tsx:8
    Migrated lodash barrel import to lodash/get

  apps/web/src/components/Layout/Footer.tsx:5
    Wrapped raw GTM <Script> in @next/third-parties GoogleTagManager

⚠ Flagged for review (2)
  apps/web/src/components/PDP/RecommendedProducts.tsx
    1000+ item array rendered without virtualisation. Consider react-window
    or pagination.

  apps/web/src/hooks/useFilters.ts:42
    useMemo wraps a primitive comparison — likely unnecessary.

Typecheck: ✓ green
```
