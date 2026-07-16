---
name: react-best-practices
description: Client-side React performance optimization patterns for rendering, re-renders, bundle size, and async operations. Use when optimizing component performance, reducing re-renders, or improving bundle size.
user-invocable: false
---
# React Best Practices

Client-side React optimization patterns for rendering, re-renders, bundle size, and async operations.

## Usage

Invoke this skill when you need to optimize component rendering, reduce unnecessary re-renders, improve bundle size, or apply best practices for useEffect, useMemo, and async patterns.

## Activation Conditions

- Performance optimization tasks
- Component re-render issues
- Bundle size concerns
- useEffect/useMemo patterns

## Examples

### Reducing Re-renders
```tsx
// Use derived state instead of syncing with useEffect
const filteredItems = items.filter(item => item.active);
// NOT: useEffect(() => setFiltered(items.filter(...)), [items])
```

### Dynamic Imports for Bundle Size
```tsx
import dynamic from 'next/dynamic';
const HeavyComponent = dynamic(() => import('./HeavyComponent'));
```

### Early Exit Pattern
```tsx
const processItems = (items: Item[]) => {
  if (!items.length) return [];
  // ... expensive processing
};
```

## Rules

See `rules/` directory for detailed guidance.
