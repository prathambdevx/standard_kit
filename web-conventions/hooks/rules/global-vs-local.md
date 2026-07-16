---
title: Global vs Local Hook Placement
impact: HIGH
impactDescription: Misplaced hooks cause circular dependencies or unnecessary coupling between features
tags: hooks, organization, architecture
---

# Global vs Local Hook Placement (HIGH)

## Explanation

Hooks can live in two locations: the global `src/hooks/` folder (shared across features) or colocated with a specific component. Choosing the right location keeps the codebase organized and avoids unnecessary coupling.

## Decision Criteria

Place in `src/hooks/` (global) when:

- The hook is used by **2+ unrelated components** in different routes/features
- It wraps a Zustand store (store wrappers are always global)
- It wraps `useApiQuery`/`useApiMutation` for a shared resource
- It provides base infrastructure (like `useApiQuery` itself)

Keep colocated with component (local) when:

- The hook is used by **only one component** or a tightly coupled group
- It manages UI-specific state (modal open/close, form validation for one form)
- It's tightly coupled to a component's internal implementation

## Examples

### Global — `src/hooks/useCustomer.ts`

Used by multiple components across the app (header, profile, checkout, etc.).

```tsx
// src/hooks/useCustomer.ts
"use client";

import { useCustomerStore } from "@/stores/customer";

export const useCustomer = () => {
  const customer = useCustomerStore((s) => s.customer);
  const setCustomer = useCustomerStore((s) => s.setCustomer);
  const clearCustomer = useCustomerStore((s) => s.clearCustomer);

  return { customer, setCustomer, clearCustomer };
};
```

### Local — Component-specific hook

Used only by `ReviewsSection` and its children.

```
src/components/Blocks/Product/ReviewsSection/
├── index.tsx
├── useReviewForm.ts    ← local hook, only used here
└── ReviewForm.tsx
```

```tsx
// src/components/Blocks/Product/ReviewsSection/useReviewForm.ts
"use client";

import { useState, useCallback } from "react";

export const useReviewForm = () => {
  const [form, setForm] = useState(INITIAL_FORM);
  // ... form-specific logic
  return { form, updateField, resetForm, isValid };
};
```

## Migration Path

If a local hook starts being needed by a second unrelated component:

1. Move it to `src/hooks/`
2. Rename the file to match global conventions (`useFeatureName.ts`)
3. Update all imports

## Anti-pattern: Over-globalizing

Do NOT put every hook in `src/hooks/`. A hook that manages a modal's open/close state for one component should stay local. Only promote to global when there's a real second consumer.

```
src/hooks/
├── useCustomer.ts           ✅ Used by 5+ components
├── useModalState.ts         ❌ Only used by one modal component
└── useProductCardHover.ts   ❌ Only used by ProductCard
```
