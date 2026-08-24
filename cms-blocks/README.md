# CMS Dynamic Blocks — any component, on any page

**Pattern:** one global block registry + one catch-all route, so any CMS block can be dropped on any page without a code change.
**Stack:** Next.js App Router (RSC) + a headless CMS with a dynamic zone (Strapi 5 assumed, but the shape is CMS-agnostic).
**Status:** architecture proposal / reference. Written up generically so it can be applied to a new project from day one.

> **Purpose of this file:** the full reasoning and code for a "truly dynamic" CMS page system — what it looks like, what it costs, what it rules out — so a new project can adopt it deliberately instead of discovering the constraints halfway through.

**How to use this folder:** there is nothing to copy — this is a decision doc, not a drop-in. Read §7 (what it rules out) and §6.3 (dev HMR cost) **before** committing to the pattern, then implement §3 against the project's own naming. The three code files in §3 are the whole implementation; everything else is the reasoning behind them. If the project already has per-page views, follow §8 and pay attention to the ordering warning on step 4.

**Decide up front:** roughly how many pages will need bespoke, non-CMS composition. One or two is fine (§7). More than a handful and this pattern is the wrong fit — use a hybrid instead.

---

## 1. The problem it solves

The common pattern is one view file per page, each importing the components that page uses:

```
modules/
  gentleman_cloth/view.tsx   → imports 8 blocks, maps them
  mills/view.tsx             → imports 5 blocks, maps them
  weaves/view.tsx            → imports 6 blocks, maps them
```

Each view owns a `__typename → component` map, so a block only renders on pages whose map includes it. Consequences:

- An editor drops an existing block onto a new page → it silently renders nothing.
- A new page in the CMS needs a developer, a route, a view file, and a deploy.
- The same block used on three pages is registered three times.
- Page-level logic starts sniffing block types to decide which layout to render, which couples layout resolution to content.

The system is "dynamic" inside a page and static about which page can use what.

---

## 2. The target architecture

```
src/
  blocks/
    registry.ts              ← the ONE map — the whole point
    hero/index.tsx
    product_rail/index.tsx
    editorial_split/index.tsx
    faq_accordion/index.tsx    ('use client')
    ...
  components/
    render_blocks/index.tsx
  app/
    [...slug]/page.tsx         ← ONE route serving every CMS page
```

There are no per-page view files, no per-page block maps, and no page-resolution logic. A new page in the CMS is live the moment an editor publishes it.

---

## 3. The code

### 3.1 The registry

```tsx
// blocks/registry.ts
import type { BlockRegistry } from '@/components/render_blocks'
import { EditorialSplit } from './editorial_split'
import { FaqAccordion } from './faq_accordion'
import { Hero } from './hero'
import { ProductRail } from './product_rail'

/** Every block the CMS can render, anywhere. Adding a block = one line here. */
export const BLOCKS = {
  ComponentBlocksHero: Hero,
  ComponentBlocksProductRail: ProductRail,
  ComponentBlocksEditorialSplit: EditorialSplit,
  ComponentBlocksFaqAccordion: FaqAccordion,
  // ...
} satisfies BlockRegistry
```

**Static imports, not `next/dynamic`.** See §6 — under RSC the dynamic version buys nothing and costs real complexity.

### 3.2 The renderer

```tsx
// components/render_blocks/index.tsx
import type { ComponentType, ReactNode } from 'react'
import { BLOCKS } from '@/blocks/registry'
import { SectionErrorBoundary } from '@/components/ui/section_error_boundary'

// any: the registry erases per-component data types — dispatch is by __typename only.
// biome-ignore lint/suspicious/noExplicitAny: see comment above
export type BlockRegistry = Record<string, ComponentType<{ data: any; priority?: boolean }>>

/**
 * Render a page's blocks in order. Unknown, hidden, and null blocks are skipped,
 * so an editor adding a block the frontend doesn't know yet degrades to nothing
 * rather than a crash. The first block is marked `priority` for its LCP image.
 */
export const RenderBlocks = ({ blocks }: { blocks: Array<Block | null> | null }): ReactNode =>
  (blocks ?? []).map((block, i) => {
    if (!block || block.show_web === false) return null

    const Component = BLOCKS[block.__typename]
    if (!Component) return null

    return (
      <SectionErrorBoundary
        key={`${block.__typename}-${'id' in block ? block.id : i}`}
        section={block.__typename}
      >
        <Component data={block} priority={i === 0} />
      </SectionErrorBoundary>
    )
  })
```

Two resilience properties worth keeping: an **unknown block renders nothing** (frontend can lag the CMS safely), and **each block is isolated in an error boundary** (one broken block hides itself, the page still renders).

### 3.3 The route

```tsx
// app/[...slug]/page.tsx
import { notFound } from 'next/navigation'
import { RenderBlocks } from '@/components/render_blocks'
import { getPage } from '@/services/cms'

export default async function CmsPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params
  const page = await getPage(slug.join('/'))
  if (!page) notFound()

  return (
    <main>
      <RenderBlocks blocks={page.blocks} />
    </main>
  )
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params
  return toMetadata(await getPage(slug.join('/')))
}
```

That is the entire page layer.

---

## 4. Three layers must know about every block

This is the part that's easy to miss. "Any component anywhere" requires all three of these to be complete — the frontend registry is only one of them, and usually the easiest.

| Layer | Must allow | Failure mode if it doesn't |
|---|---|---|
| **1. CMS dynamic zone** | the component is permitted on the Page content type | editor simply can't add the block |
| **2. API query / GraphQL fragment** | an inline fragment selecting that block's fields | block comes back as `__typename` only, with no data — renders empty |
| **3. Frontend registry** | `__typename → component` | `BLOCKS[typename]` is undefined — renders nothing |

**Layer 2 is the real ceiling and the quiet one.** If the CMS is fully permissive but the query's union hasn't caught up, an editor adds a block, the API returns nothing useful, and the page renders a hole with no error anywhere. Extending the fragment is mechanical but it must lead, not follow.

A cheap guard worth adding: a build-time or test-time check that the set of block types in the CMS schema, the set in the query union, and the keys of `BLOCKS` are identical. Three lists that must match are exactly the thing to assert automatically rather than remember.

---

## 5. Where per-page variation goes

This is the philosophical shift, and holding this line is what keeps the architecture from decaying.

When someone says *"the product rail should look different on the fabrics page"*, do **not** add a per-page override map or a handle check. Put the variant on the block, in the CMS:

```tsx
// blocks/product_rail/index.tsx
export const ProductRail = ({ data }: { data: ProductRailBlock }) => (
  <section className={data.variant === 'compact' ? 'gap-2' : 'gap-6'}>
    ...
  </section>
)
```

**Variation moves from code to content.** The editor picks the variant; the code stays fully generic and page-agnostic.

The first time `if (page.handle === 'x')` appears anywhere in a block or the renderer, the system is back to per-page views with extra indirection. That single rule is the difference between this pattern working for years and rotting in six months.

---

## 6. Performance — what this actually costs

The instinct is that importing every block in one file bloats the bundle, and that this needs `next/dynamic` to fix. Under the App Router that instinct is mostly wrong. Here is the honest breakdown.

### 6.1 Client bundle — no meaningful change

**Server Components ship zero JavaScript to the browser.** They render on the server; only HTML and the RSC flight payload go over the wire. If most blocks are server components — in practice the large majority usually are, since blocks are typically presentational — then a registry importing all of them adds **nothing** to the client bundle.

For the minority marked `'use client'`, Next emits a client reference per module and the RSC payload only references the ones **actually rendered**. A page that doesn't render `FaqAccordion` never downloads its chunk, even though the registry imports it statically. **RSC already does the thing `next/dynamic` would be added to do.**

*The one real caveat:* bundler chunk-grouping heuristics can merge several small client chunks into one, so rendering one client block may pull a couple of neighbours. This is minor, and it's measurable with a bundle analyzer rather than something to guess about. If it ever shows up as a real number, apply `next/dynamic` to those specific client blocks — that is the only place it pays.

### 6.2 Runtime — unchanged on a warm server, marginal on cold start

The registry module graph means all block modules are loaded and evaluated when the route module first loads. Node caches modules, so:

- **Long-running server:** paid once at boot, zero ongoing cost. No per-request impact.
- **Serverless / Lambda:** adds a few milliseconds of module evaluation to a **cold** start only.

So "no runtime impact" is accurate for a warm server. On serverless it's a small, one-time-per-instance cost — worth stating honestly rather than claiming zero.

Rendering cost itself is identical: `BLOCKS[typename]` is an object lookup, and the same components render either way.

### 6.3 Build — smaller impact than expected; dev HMR is where you feel it

This is the claim most worth checking rather than assuming, because it cuts both ways:

- **Production build: roughly a wash.** Every block was already being compiled — previously distributed across N route entries, now concentrated in one. Replacing 13 route entries with a single catch-all removes per-route overhead that partly offsets the bigger single graph. Total module count is unchanged.
- **Dev HMR: genuinely slower, and this is the real cost.** The registry is a *hub* module. Editing any single block invalidates the registry, which invalidates the one route that depends on it — a wider invalidation than a per-page map, where editing a block only rebuilds the pages using it. On a large block set this is noticeable during day-to-day development.
- **Type-checking:** effectively unchanged.

**Verdict on the original claim:** "won't hurt site performance, might make the build slower" is broadly right, with two corrections — there's a small serverless cold-start cost, and the build slowdown lands mostly in **dev HMR** rather than the production build.

If dev HMR becomes painful, the mitigation is to split the registry into a few domain-grouped files (`blocks/registry/marketing.ts`, `blocks/registry/commerce.ts`) merged into one exported object. That narrows invalidation without reintroducing per-page coupling — the merged map is still global.

---

## 7. What this rules out

Be honest about this up front, because it's the real tradeoff.

You can no longer express *"this page is structurally special"* in code. A page needing bespoke composition — static sections interleaved between CMS blocks, blocks grouped into a custom sub-layout, a fundamentally different shell — doesn't fit the generic route.

The escape hatch is a **real hand-written route at its own path**, sitting entirely outside this system. That's fine for one or two. If more than a handful of pages need it, the fully generic model is fighting the design and a hybrid (generic route for most, explicit routes for the rest) is the more honest answer.

Decide roughly how many bespoke pages you expect **before** adopting this. It's a cheap question up front and an expensive one later.

---

## 8. Migrating an existing project

If per-page views already exist, the order matters — step 4 must land with step 1, or page resolution breaks.

1. **Build the global registry** — one file, static imports, every block.
2. **Extend the API query union** so every block returns real data (§4, layer 2). Usually the bulk of the work, and mechanical.
3. **Open the CMS dynamic zone** to all blocks on the page type.
4. **Replace any block-sniffing page resolution.** If layout is chosen by inspecting which block types are present, that logic is *circular* under this architecture — once every block can appear anywhere, no block identifies a page. Switch to the route slug, or an explicit `layout` field on the CMS page entry.
5. **Delete the "generic blocks" concept.** A partial version of this pattern (a small set of blocks registered on every page) usually already exists. Once everything is generic, the distinction is meaningless — remove it rather than leaving two mechanisms.
6. **Keep genuinely bespoke pages as explicit routes** (§7).

Step 4 is the one that bites: it's easy to ship steps 1–3, feel done, and discover layout resolution has quietly started picking the wrong view.

---

## 9. Summary

| | Per-page views | Global registry |
|---|---|---|
| New CMS page | route + view + deploy | publish in CMS |
| Block on a new page | code change | drag it in |
| Block registered | once per page using it | once, globally |
| Page-level variation | per-page code map | CMS field on the block |
| Client bundle | same | same (RSC) |
| Dev HMR | narrower invalidation | wider — the real cost |
| Bespoke page layouts | natural | needs an explicit route |
