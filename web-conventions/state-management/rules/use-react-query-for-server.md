---
title: Server data uses TanStack Query, never client state
impact: HIGH
impactDescription: Holding server data in Zustand/useState loses caching, refetch, and invalidation — leading to stale data and duplicated fetch logic
tags: tanstack-query, server-state, zustand, useState
---

# Server data → TanStack Query (HIGH)

## Explanation

Server data fetched **on the client** (after an interaction — not at page load) goes through `useApiQuery` / `useApiMutation` from `src/hooks/`. Never store a BFF/Shopify response in a Zustand store or in `useState` + `useEffect`. TanStack Query owns caching, background refetch, and invalidation; client-state tools don't.

Server data fetched **at page load** doesn't touch client state at all: it's fetched in `services/bff/<domain>.ts` from `page.tsx` (server-only) and passed to `view.tsx` as props (see CLAUDE.md import rule 8). TanStack Query is only for the client-fetch case.

## Incorrect

```tsx
// Server data in Zustand — loses caching/invalidation, duplicates fetch logic
const useProductStore = create((set) => ({
  products: [],
  setProducts: (products) => set({ products }),
}));

// Server data in useState + useEffect — same problem, plus race conditions
const ProductRail = () => {
  const [products, setProducts] = useState([]);
  useEffect(() => { fetchRelated(handle).then(setProducts); }, [handle]);
  return <Rail items={products} />;
};
```

## Correct

```tsx
'use client';
import { useApiQuery } from '@/hooks/useApiQuery';

const ProductRail = ({ handle }: { handle: string }) => {
  const { data, isLoading, error } = useApiQuery({
    queryKey: ['related', handle],
    queryFn: () => fetchRelated(handle),
    staleTime: 1000 * 60 * 5,
  });

  if (isLoading) return <RailSkeleton />;
  if (error) return null;
  return <Rail items={data ?? []} />;
};
```

For wrapping `useApiQuery` into a focused data-fetching hook, see the `hooks` skill. For why read-only catalog data stays SDK-only (no commerce store) and pairs with react-query per app, see the root `extend-commerce` skill.

## When to use what

| Data | Solution |
|---|---|
| BFF/Shopify response at page load | `services/bff` → props (server-only, no client state) |
| BFF/Shopify response on interaction | `useApiQuery` / `useApiMutation` |
| Session / cart / recently-viewed / customizer | `commerce.useX` (bsc-commerce — already cached/persisted) |
| Web-only persisted client state (pincode) | Zustand `persist` in `lib/` |
| Cross-cutting UI state (drawers, pending flags) | Zustand in `lib/` |
| Module-only UI state | Zustand inside the module |
| Component-only UI state | `useState` / `useReducer` |
