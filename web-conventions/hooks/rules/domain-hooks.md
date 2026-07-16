---
title: Domain/Feature Hooks
impact: MEDIUM
impactDescription: Poorly structured domain hooks become unmaintainable and hard to test
tags: hooks, domain, feature, complex-hooks
---

# Domain/Feature Hooks (MEDIUM)

## Explanation

Domain hooks encapsulate complex feature logic — combining data fetching, local state, derived values, and actions into one cohesive API. They are the most complex hook category and require careful structure. Example: `useReviews` manages fetching, pagination, sorting, form state, image uploads, and submission for the reviews feature.

## When to Create a Domain Hook

Create a domain hook when a feature needs:

- Multiple pieces of local state (`useState`)
- Data fetching via `useApiQuery`/`useApiMutation`
- Derived/computed values (`useMemo`)
- Multiple action handlers (`useCallback`)
- Coordination between these concerns

## Structure

```tsx
"use client";

import { useState, useCallback, useMemo } from "react";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useApiMutation } from "@/hooks/useApiMutation";

// Private helpers (not exported)
const transformData = (raw: RawType): CleanType => { ... };

// Exported types if consumers need them
export interface FeatureFormState { ... }

// The hook
export const useFeature = (resourceId: string, initialData?: Data) => {
  // 1. Local state
  const [page, setPage] = useState(1);
  const [form, setForm] = useState(INITIAL_FORM);

  // 2. Data fetching
  const query = useApiQuery({ ... });
  const mutation = useApiMutation({ ... });

  // 3. Derived values
  const items = useMemo(() => ..., [query.data]);
  const hasMore = page < totalPages;

  // 4. Actions
  const loadMore = useCallback(() => { ... }, [hasMore]);
  const handleSubmit = useCallback(() => { ... }, [form]);

  // 5. Return grouped by concern
  return {
    // Data
    items,
    isLoading: query.isLoading,
    hasMore,

    // Pagination
    loadMore,

    // Form
    form,
    updateForm,
    resetForm,

    // Submission
    handleSubmit,
    isSubmitting: mutation.isPending,
    submitError,
  };
};
```

## Rules

### 1. Keep private helpers outside the hook

Transform functions, constants, and type mappers should be defined outside the hook body to avoid recreation on every render:

```tsx
// Correct — outside hook, created once
const mapApiReview = (r: ApiReview): Review => ({ ... });

export const useReviews = () => {
  const reviews = useMemo(() => data.map(mapApiReview), [data]);
};

// Incorrect — recreated every render
export const useReviews = () => {
  const mapReview = (r: ApiReview): Review => ({ ... });
  const reviews = useMemo(() => data.map(mapReview), [data]);
};
```

### 2. Group return values by concern

Organize the returned object into logical groups with clear names:

```tsx
return {
  // List data
  reviews,
  totalReviews,
  reviewImages,
  isLoading,

  // Pagination
  hasMore,
  loadMore,
  isFetchingMore,

  // Sort
  changeSort,

  // Form
  form,
  updateForm,
  resetForm,
  hoverRating,
  setHoverRating,

  // Submit
  handleSubmit,
  isSubmitting,
  submitError,
  canSubmit,
};
```

### 3. Accept initial/server data as parameters

When a feature receives server-rendered initial data, accept it as a hook parameter to seed the cache:

```tsx
export const useReviews = (productId: string, initialReviews?: ReviewsApiResponse | null) => {
  // Seed cache with server data
  useEffect(() => {
    if (initialReviews) {
      queryClient.setQueryData(["reviews", productId], initialReviews);
    }
  }, [initialReviews, productId, queryClient]);
};
```

### 4. Use `useCallback` with inline function expressions

React Compiler enforces inline function expressions in `useCallback`. Do not pass function references directly:

```tsx
// Correct — inline function expression
const loadMore = useCallback(() => {
  if (hasMore && !isFetching) setPage((p) => p + 1);
}, [hasMore, isFetching]);

// Incorrect — React Compiler will error
const increment = (p: number) => p + 1;
const loadMore = useCallback(increment, []);
```

### 5. Split if hook exceeds ~150 lines of logic

If a domain hook grows beyond ~150 lines of actual logic (excluding types/imports), consider extracting sub-hooks:

```
src/components/Blocks/Product/ReviewsSection/
├── useReviews.ts          → orchestrator hook
├── useReviewsList.ts      → fetch + pagination
├── useReviewForm.ts       → form state + validation
└── useReviewSubmit.ts     → submission + image upload
```

The orchestrator hook composes the sub-hooks and returns a unified API.

## Placement

Domain hooks that serve a single component tree → colocate with the component.
Domain hooks used across 2+ unrelated features → `src/hooks/`.
