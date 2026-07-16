---
title: Persist web-only client state with the persist middleware
impact: HIGH
impactDescription: Persisted UI state must survive reload without breaking SSR; getting hydration wrong causes mismatches
tags: zustand, persist, localStorage, ssr
---

# Persist a web-only Zustand store (HIGH)

## Scope

This is for **web-only** persisted UI/client state — e.g. the delivery pincode. State that is persisted *and* shared with mobile (session, cart, recently-viewed) is **not** a web store: it lives in `@devxcommerce/bsc-commerce`, which owns hydration/expiry/login-merge internally and is hydrated once via `commerce.hydrate()`. Don't reimplement that here — see the root `extend-commerce` skill.

## Pattern

`persist` + `createJSONStorage(() => localStorage)`. On the server `localStorage` is undefined; `createJSONStorage` swallows the throw and no-ops, then rehydrates on the client. No `StoreInitializer`, no `skipHydration` for these simple `lib/` stores.

```tsx
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

type PincodeState = {
  pincode: string | null;
  setPincode: (pincode: string) => void;
  clearPincode: () => void;
};

export const usePincode = create<PincodeState>()(
  persist(
    (set) => ({
      pincode: null,
      setPincode: (pincode) => set({ pincode }),
      clearPincode: () => set({ pincode: null }),
    }),
    { name: 'bsc-pincode', storage: createJSONStorage(() => localStorage) },
  ),
);
```

Canonical example: `src/lib/pincode.ts`. Naming: `bsc-`-prefixed storage key.

## Placement still applies

A persisted store follows the same placement rule as any Zustand store: in `lib/` if a shared component reads it, otherwise inside the module. Persistence doesn't change where it lives — only how it's declared.

## Incorrect

```tsx
// Reading window/localStorage at module top level — crashes during SSR
const initial = localStorage.getItem('bsc-pincode'); // ReferenceError on the server

// Non-persisted store for something that must survive reload
export const usePincode = create<PincodeState>((set) => ({ /* lost on refresh */ }));
```
