# web-conventions — React/Next.js engineering skills

General-purpose React + Next.js conventions and performance rules — no BSC/commerce coupling in any
of these (verified before including).

| Folder | What it covers |
|---|---|
| `layout-thrashing/` | Detect + fix forced reflows, read/write DOM interleaving, unbatched layout reads in loops, expensive scroll/resize handlers |
| `state-management/` | Decision tree for **which** state tool (server data → TanStack Query, cross-cutting UI → Zustand in a shared layer, feature-local UI → Zustand in the module, component-local → `useState`) + **where** a store lives, driven by the import graph. 3 sub-rules: server-data-never-in-client-state, always-use-a-selector, persist-pattern for web-only client state. |
| `fix-performance/` | Applies an LCP/CLS/INP/bundle/TanStack-Query rule pass — what to check, what's auto-fixable, what needs human judgment (e.g. "which image is the LCP") |
| `hooks/` | Hook categories (store wrapper / query base / data-fetching / domain), naming conventions, import-layer rules, `"use client"` placement. 4 sub-rules: global-vs-local, store-wrapper-pattern, tanstack-query-wrapper, domain-hooks |
| `react-best-practices/` | 39 granular rules across rendering, re-renders, async, bundle size, and raw-JS micro-optimizations (each its own file — early-exit, memo, lazy state init, transitions, dynamic imports, barrel-import avoidance, etc.) |
| `nextjs-app-router-patterns/` | Server/Client Component boundary, Server Actions, parallel + intercepting routes, streaming with Suspense, route handlers, metadata/SEO, caching strategies (`cache`, `revalidate`, `tags`) |

## A note on `state-management` — verified, not stale

This one references a specific package (`@devxcommerce/bsc-commerce`) and a specific set of files
(`lib/drawers.ts`, `lib/pincode.ts`, `useUiStore`, `useHeaderTheme`, etc.) — every one of those was
checked against the live filesystem before inclusion and confirmed current. The **package name is
project-specific** (swap for whatever shared cross-platform state package your project uses, or
delete that row from the decision tree if there isn't one) — but the underlying decision tree (server
state → query lib; state shared across web+mobile → a platform-pure package; cross-cutting UI state →
a shared-layer store; feature-local UI state → a module-local store; component state → `useState`) and
the placement rule (driven by who imports the store, not preference) are the reusable core.

**`hooks/`'s original "Current Hooks Inventory" table was stripped** — it listed 7 specific hook
files, none of which still exist in the source project (superseded by the commerce-package
consumption pattern `state-management` documents). A fixed inventory table doesn't belong in a
portable kit anyway — a new project's actual hook list will differ immediately. What's left is the
category/naming/import-layer guidance, which is what's actually reusable.

## Adapt before use

- `state-management`: swap `@devxcommerce/bsc-commerce` for your project's actual shared-state
  package name (or delete that tier if there isn't one).
- `hooks` / hook-naming examples (`useCustomer`, `useCart`, `useShopifyProducts`) are illustrative
  names showing the *pattern* (`use{StoreName}`, `use{Resource}`) — not literal files to expect.
- The rest (`layout-thrashing`, `fix-performance`, `react-best-practices`,
  `nextjs-app-router-patterns`) are framework-level and need no adaptation.
