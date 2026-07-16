---
title: Store Wrapper Hook Pattern
impact: CRITICAL
impactDescription: Direct store imports in components couple them to store internals and prevent centralized API changes
tags: hooks, zustand, store, wrapper, selectors
---

# Store Wrapper Hook Pattern (CRITICAL)

## Explanation

Every Zustand store is accessed through a thin wrapper hook in `src/hooks/`. Components never import stores directly. This provides a stable public API and centralizes selector logic.

## Pattern

```tsx
"use client";

import { useXxxStore } from "@/stores/xxx";

export const useXxx = () => {
  // 1. Select individual values with selectors
  const value = useXxxStore((s) => s.value);
  const action = useXxxStore((s) => s.action);

  // 2. Optionally derive computed values with useMemo
  // const derived = useMemo(() => ..., [value]);

  // 3. Return flat object
  return { value, action };
};
```

## Rules

### 1. One selector per value

Each value gets its own selector call. This ensures minimal re-renders — components only re-render when their specific data changes.

```tsx
// Correct — individual selectors
const customer = useCustomerStore((s) => s.customer);
const setCustomer = useCustomerStore((s) => s.setCustomer);

// Incorrect — subscribes to entire store
const { customer, setCustomer } = useCustomerStore();
const store = useCustomerStore();
```

### 2. Return direct values, not getter functions

Wrapper hooks return values directly. Never wrap state in getter functions.

```tsx
// Correct — direct values
return { customer, setCustomer, clearCustomer };

// Incorrect — getter function pattern
return {
  getCustomer: () => customer,
  setCustomer,
};
```

### 3. Split read and write hooks when the store is large

For stores with many fields, split into a read hook and an actions hook:

```tsx
// useCart.ts — read-only state + derived values
export const useCart = () => {
  const cart = useCartStore((s) => s.cart);
  const localCart = useCartStore((s) => s.localCart);
  const isLoading = useCartStore((s) => s.isLoading);

  const lines = useMemo(() => localCart?.lines.edges.map((e) => e.node) ?? [], [localCart]);

  return { cart, localCart, lines, isLoading };
};

// useCartActions.ts — mutations only
export const useCartActions = () => {
  const addItem = useCartStore((s) => s.addItem);
  const removeItem = useCartStore((s) => s.removeItem);

  return { addItem, removeItem };
};
```

### 4. Derived values use `useMemo`

If the wrapper computes a value from store state, use `useMemo`:

```tsx
// useGender.ts
const gender = useMemo((): GenderType => {
  if (pathname === "/") return "MEN";
  if (pathname.startsWith("/women")) return "WOMEN";
  return storedGender;
}, [pathname, storedGender]);
```

### 5. Don't wrap actions in `useCallback`

Zustand actions are already stable references. Wrapping them in `useCallback` is unnecessary.

```tsx
// Correct — actions are stable, return directly
const setCustomer = useCustomerStore((s) => s.setCustomer);
return { setCustomer };

// Incorrect — unnecessary useCallback
const setCustomer = useCustomerStore((s) => s.setCustomer);
const wrappedSet = useCallback((c: Customer) => setCustomer(c), [setCustomer]);
return { setCustomer: wrappedSet };
```

## Existing Store Wrappers

| Hook             | Store          | Read/Write | Notes                                                 |
| ---------------- | -------------- | ---------- | ----------------------------------------------------- |
| `useApp`         | app-store      | Both       | Mixpanel loading state                                |
| `useCustomer`    | customer-store | Both       | Customer CRUD                                         |
| `useGender`      | gender-store   | Both       | Derives gender from pathname + stored preference      |
| `useCart`        | cart-store     | Read       | Derived `lines`, `totalQuantity`, `subtotal`, `total` |
| `useCartActions` | cart-store     | Write      | `addItem`, `removeItem`, `updateItemQuantity`, etc.   |

## Creating a New Store Wrapper

1. Create file: `src/hooks/use{StoreName}.ts`
2. Add `"use client"` directive
3. Import the store from `@/stores/{storeName}`
4. Select each value/action with individual selectors
5. Add derived values with `useMemo` if needed
6. Return a flat object
7. Export as named export
