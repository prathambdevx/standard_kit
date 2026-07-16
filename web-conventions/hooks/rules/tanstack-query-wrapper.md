---
title: TanStack Query Wrapper Hooks
impact: HIGH
impactDescription: Inconsistent query/mutation patterns lead to cache key collisions, stale data, and poor error handling
tags: hooks, tanstack-query, react-query, data-fetching
---

# TanStack Query Wrapper Hooks (HIGH)

## Explanation

Client-side data fetching uses TanStack Query through two base hooks: `useApiQuery` and `useApiMutation`. All data-fetching hooks compose these base hooks — never call `useQuery`/`useMutation` directly in components or new hooks.

## Base Hooks

### `useApiQuery` — for reads

```tsx
import { useApiQuery } from "@/hooks/useApiQuery";

const { data, isLoading, isError, error } = useApiQuery({
  queryKey: ["resource", id], // Unique cache key
  queryFn: () => fetchResource(id), // Service function
  params: [], // Extra params (passed to queryFn)
  enabled: !!id, // Conditional fetching
  // staleTime, gcTime, retry — inherit from QueryProvider unless overridden
});
```

### `useApiMutation` — for writes

```tsx
import { useApiMutation } from "@/hooks/useApiMutation";

const mutation = useApiMutation({
  mutationFn: submitData,
  invalidateQueries: [["resource"]], // Auto-invalidate on success
  updateQueries: [
    {
      // Optimistic cache update
      queryKey: ["resource", id],
      updater: (oldData, newData) => ({ ...oldData, ...newData }),
    },
  ],
  onSuccess: (data) => {
    /* handle success */
  },
  onError: (error) => {
    /* handle error */
  },
  // retry — inherits from QueryProvider unless overridden
});

// Usage
mutation.mutate([param1, param2]);
```

## Creating a Data-Fetching Hook

When a specific API call is used by 2+ components, wrap it in a dedicated hook:

```tsx
// src/hooks/useShopifyProducts.ts
import { getShopifyProducts } from "@/libs/serverAPI";
import { useApiQuery } from "./useApiQuery";

export const useShopifyProducts = (productIds: string[]) => {
  const {
    data: products,
    isLoading,
    isError,
    error,
  } = useApiQuery({
    queryKey: ["shopifyProducts", ...productIds],
    queryFn: () => getShopifyProducts({ productIds }),
    params: [],
    enabled: productIds.length > 0,
  });

  return { products, isLoading, isError, error };
};
```

## Rules

### 1. Query keys must be deterministic and unique

Include all parameters that affect the response in the query key:

```tsx
// Correct — includes all params
queryKey: ["reviews", productId, page, sort, order, limit];

// Incorrect — missing params, causes stale cache hits
queryKey: ["reviews", productId];
```

### 2. Use `enabled` to prevent unnecessary fetches

```tsx
// Correct — only fetches when productId exists
enabled: !!productId && productIds.length > 0;

// Incorrect — fetches immediately, may fail
enabled: true; // (or omitting enabled)
```

### 3. Service functions go in `services/` or `libs/`

Hooks call service functions — they don't contain fetch logic themselves:

```tsx
// Correct — hook calls a service
import { getShopifyProducts } from "@/libs/serverAPI";
queryFn: () => getShopifyProducts({ productIds });

// Incorrect — fetch logic inside hook
queryFn: () => fetch(`/api/products?ids=${productIds.join(",")}`);
```

### 4. Return a clean interface

Destructure and rename TanStack Query's return values for a cleaner API:

```tsx
export const useShopifyProducts = (productIds: string[]) => {
  const { data: products, isLoading, isError, error } = useApiQuery({ ... });

  return { products, isLoading, isError, error };
};
```

### 5. Never call `useQuery`/`useMutation` directly

Always go through `useApiQuery`/`useApiMutation` to ensure consistent defaults (staleTime, gcTime, retry).

```tsx
// Correct
import { useApiQuery } from "@/hooks/useApiQuery";

// Incorrect
import { useQuery } from "@tanstack/react-query";
```
