---
title: Always read Zustand with a selector
impact: CRITICAL
impactDescription: Subscribing to the whole store re-renders the component on every unrelated store change
tags: zustand, selectors, performance, bsc-commerce
---

# Use Zustand selectors (CRITICAL)

## Explanation

Every read from a Zustand store — a `lib/` store, a module store, or a `bsc-commerce` selector hook — passes a selector. No selector means the component re-renders on *any* store change, including unrelated fields.

## Incorrect

```tsx
// Whole store — re-renders on every field change
const drawer = useSizeDrawer();
return drawer.product ? <SizeDrawer /> : null;

// Destructuring without a selector — still subscribes to everything
const { product } = useSizeDrawer();
```

## Correct

```tsx
// lib/ store — one selector per value read
const product = useSizeDrawer((s) => s.product);
const open = useSizeDrawer((s) => s.open);   // actions are stable refs

// bsc-commerce — same rule via its selector hook
import { commerce } from '@/lib/commerce';
const isLoggedIn = commerce.useSession((s) => s.isLoggedIn);
const totalQty = commerce.useCart((s) => s.lines.reduce((n, l) => n + l.quantity, 0));
```

## Computed reads

Derive cheaply *inside* the selector, or `useMemo` in a wrapper hook if the derivation is non-trivial:

```tsx
const isEmpty = commerce.useCart((s) => s.lines.length === 0);
```

## Prefer the wrapper hook for commerce / large stores

Components consume commerce state through wrapper hooks in `src/hooks/` (`useMembership`, `useRecentlyViewedCards`) rather than reaching into `commerce` everywhere — a stable public API. Simple `lib/` UI stores (drawers, pending flags) are read directly with a selector; they're already the public API. The wrapper pattern, read/write splits, and `useMemo` derivation live in the `hooks` skill.
