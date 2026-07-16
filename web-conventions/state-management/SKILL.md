---
name: state-management
description: Pick the right state home for the BSC web app — TanStack Query for server state, Zustand for UI/client state — and place each store correctly (module-scoped vs lib/ vs the bsc-commerce package). Use when deciding between state solutions, creating a Zustand store, or wiring server data on the client.
user-invocable: false
---
# State management

The routing decision that sits *upstream* of how you write the hook. This skill answers **which tool** and **where the store lives**. For how to wrap a store or query in a hook, see the `hooks` skill. For building stores *inside* the packages, see the root `extend-commerce` skill.

## The split (read first)

| State | Tool | Lives in |
|---|---|---|
| Server data (BFF/Shopify responses) on the client | **TanStack Query** (`useApiQuery` / `useApiMutation`) | `src/hooks/` |
| Persisted client state with a lifecycle shared web+mobile (session, cart, recently-viewed, customizer) | **`@devxcommerce/bsc-commerce` store** | the package — never re-create in web |
| Cross-cutting UI state used by ≥2 modules + shared components | **Zustand** | `src/lib/` |
| Feature-scoped UI state used by one module only | **Zustand** | inside that `src/modules/<feature>/` |
| State scoped to one component | `useState` / `useReducer` | the component |

Server data is **never** held in Zustand or `useState`+`useEffect` — TanStack Query owns caching, refetch, and invalidation. Server fetches on a *page* go through `services/bff/<domain>.ts` in `page.tsx` (server-only) and are passed to `view.tsx` as props; TanStack Query is only for data fetched *on the client* (after interaction).

## Decision tree

```
Is it server data (a BFF/Shopify response)?
├── Yes → fetched at page load?    → services/bff in page.tsx → props (no client state)
│         fetched on interaction?  → TanStack Query: useApiQuery / useApiMutation (src/hooks/)
└── No → does it already live in @devxcommerce/bsc-commerce?
    │     (session · cart · recentlyViewed · customizer · authFlow)
    ├── Yes → consume the shared instance: commerce.useX((s) => …) — DON'T re-create it
    └── No → is it shared across ≥2 modules / shared components?
        ├── Yes → Zustand store in src/lib/
        └── No → used by exactly one module?
            ├── Yes → Zustand store inside src/modules/<feature>/
            └── No → useState / useReducer (component-local)
```

## Store placement — the dependency-cruiser rule

Placement is dictated by the import graph (`bun depcruise`), not preference:

- **`src/lib/<name>.ts`** — for stores read by **shared components** (`components/common/`, `components/ui/`) *and* modules. The shared layer cannot import from `modules/` (rule 5), so a store it consumes must live in `lib/`. Live examples: `lib/drawers.ts` (size / profile / gift-card / added-to-bag drawers — opened from cards, PDP, cart, header), `lib/plp_filter_pending.ts` (filter/sort pending flag survives drawer unmount), `lib/pincode.ts` (persisted delivery pincode).
- **`src/modules/<feature>/`** — for stores used only inside one feature module. No shared component touches it, so it stays in the slice. Live example: `modules/account/address/hooks/useAddressDialogs.ts`.

Rule of thumb: **a shared component imports it → it must be in `lib/`.** Otherwise keep it in the module. (Note: a couple of cross-cutting UI stores currently sit in `src/hooks/` — `useUiStore`, `useHeaderTheme` — these predate the rule; new cross-cutting stores go in `lib/`.)

## bsc-commerce stores — consume, don't re-create

`session`, `cart`, `recentlyViewed`, `customizer`, and `authFlow` are owned by `@devxcommerce/bsc-commerce` (ADR-0006: platform-pure, app-injects storage). The web app has **one** instance at `src/lib/commerce.ts` (storage = `localStorage`, `memoryStorage()` on the server; hydrated once client-side in `providers/ClientProviders.tsx`). Read these via the selector hooks — never make a parallel Zustand store for the same domain:

```tsx
import { commerce } from '@/lib/commerce';

const isLoggedIn = commerce.useSession((s) => s.isLoggedIn);
const lines = commerce.useCart((s) => s.lines);
```

Adding a *new* domain to that package (a new persisted lifecycle store shared with mobile) is the `extend-commerce` skill's job — not a `lib/` store. A `lib/` store is for **web-only UI state**; a commerce store is for **shared, persisted, platform-pure business state**.

## Persistence

For a web-only persisted Zustand store, use the `persist` middleware with `createJSONStorage(() => localStorage)` — it no-ops server-side (`localStorage is not defined` is swallowed) and rehydrates on the client. See `lib/pincode.ts` for the canonical example. Persisted *commerce* stores are different — they handle hydration/expiry/login-merge inside the package (`commerce.hydrate()`); don't reimplement that in web.

## Selectors (non-negotiable)

Every Zustand read uses a selector — both for `lib/`/module stores (`useStore((s) => s.value)`) and commerce hooks (`commerce.useCart((s) => …)`). Subscribing to the whole store re-renders on every unrelated change. Detail + the wrapper-hook pattern: the `hooks` skill.

## Rules

See `rules/`:
| Rule | Topic |
|---|---|
| `use-react-query-for-server.md` | server data → TanStack Query, never client state |
| `use-zustand-selectors.md` | always select; never subscribe to the whole store |
| `use-zustand-persist.md` | web-only persisted `lib/` stores |
