---
name: hooks
description: Create, organize, and maintain custom React hooks following project conventions and best practices. Use when creating new hooks, wrapping Zustand stores, or composing TanStack Query calls.
user-invocable: false
---
# Hooks

Guidelines for creating, organizing, and maintaining custom React hooks in this project.

## Usage

Invoke this skill when you need to create a new custom hook, decide where to place hook logic, or wrap a store or query for component consumption.

## Activation Conditions

- Creating a new custom hook
- Deciding where to place a hook (global vs component-level)
- Wrapping a Zustand store for component consumption
- Wrapping TanStack Query for client-side data fetching
- Reviewing or refactoring existing hooks

## Quick Reference

| Action                      | Rule                        |
| --------------------------- | --------------------------- |
| Decide global vs local      | `global-vs-local.md`        |
| Wrap a Zustand store        | `store-wrapper-pattern.md`  |
| Wrap TanStack Query         | `tanstack-query-wrapper.md` |
| Build a domain/feature hook | `domain-hooks.md`           |

## Naming Conventions

- **File names:** camelCase matching the hook function name — `useCustomer.ts`, `useApiQuery.ts`
- **Function names:** `use` prefix + PascalCase descriptor — `useCustomer`, `useShopifyProducts`
- **Named exports only** (project enforces `import/no-default-export`)
- **One primary hook per file.** Private helpers can live in the same file.

| Category       | Naming pattern          | Examples                              |
| -------------- | ----------------------- | ------------------------------------- |
| Store wrapper  | `use{StoreName}`        | `useCustomer`, `useGender`, `useCart` |
| Store actions  | `use{StoreName}Actions` | `useCartActions`                      |
| Query base     | `useApi{Operation}`     | `useApiQuery`, `useApiMutation`       |
| Data-fetching  | `use{Resource}`         | `useShopifyProducts`                  |
| Domain/feature | `use{Feature}`          | `useReviews`                          |

## Hook Categories

This project has four categories of hooks. Each serves a distinct purpose:

```
src/hooks/
├── Store wrappers        → useApp, useCustomer, useGender, useCart, useCartActions
├── TanStack Query base   → useApiQuery, useApiMutation
├── Data-fetching hooks   → useShopifyProducts (composes useApiQuery)
└── Domain/feature hooks  → useReviews (complex, self-contained feature logic)
```

### 1. Store Wrapper Hooks

Thin wrappers around Zustand stores. Provide a stable public API so components never import stores directly.

### 2. TanStack Query Base Hooks

Generic wrappers (`useApiQuery`, `useApiMutation`) that standardize query/mutation options across the app. Other hooks compose these.

### 3. Data-Fetching Hooks

Compose `useApiQuery`/`useApiMutation` for specific API calls. Keep them focused on one resource or endpoint.

### 4. Domain/Feature Hooks

Complex hooks that combine state, data-fetching, and business logic for a specific feature (e.g., `useReviews`). These typically manage multiple pieces of local state and compose other hooks.

## Decision Tree

```
Need to access a Zustand store from a component?
├── Yes → Use existing store wrapper hook (useCustomer, useCart, etc.)
│         If no wrapper exists → Create one in src/hooks/ (see store-wrapper-pattern.md)
└── No
    Need to fetch server data on the client?
    ├── Yes → Is it a single API call?
    │   ├── Yes → Compose useApiQuery in a new hook in src/hooks/
    │   └── No  → Create a domain hook (see domain-hooks.md)
    └── No
        Is the logic reused across 2+ unrelated components?
        ├── Yes → Create hook in src/hooks/ (global)
        └── No  → Keep hook in the component folder (local)
```

## Import Rules

Hooks follow the project's layered architecture:

| Hook type        | Can import from                           | Cannot import from         |
| ---------------- | ----------------------------------------- | -------------------------- |
| Store wrappers   | `stores/`, `utils/`                       | `services/`, `components/` |
| Query base hooks | `@tanstack/react-query`                   | `services/`, `stores/`     |
| Data-fetching    | `hooks/useApiQuery`, `services/`, `libs/` | `stores/`, `components/`   |
| Domain hooks     | `hooks/*`, `libs/`, `services/`, `types/` | `components/`              |

## `"use client"` Directive

Any hook file that calls React hooks (`useState`, `useMemo`, etc.), Zustand selectors, TanStack Query hooks, or Next.js hooks (`usePathname`, `useRouter`) must start with `"use client"` as the very first line before any imports.

## Rules

See `rules/` directory for detailed guidance on each topic.
