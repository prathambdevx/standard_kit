---
paths: ["apps/bff/src/modules/**/*.ts", "apps/bff/src/services/**/*.ts", "packages/types/src/routes/*.ts"]
---

# Comment style for BFF TypeScript files

> Scope: the backend in `apps/bff/` and the shared route types in `packages/types/`.
> React component comment style lives in `.claude/rules/comments-web.md` (scoped to `*.tsx`/`*.jsx`).

Keep comments short, human-readable, and focused on *why* — not *what*. Add them only where they help a reader who knows TypeScript but doesn't know BSC's Shopify setup or internal conventions. Default to no comment.

Three categories apply: **type field annotations**, **inline `//` intent comments**, and **one-line `/** */` docstrings**. Everything else is noise.

---

## 1. Type field annotations — explain units, encoding, invariants

Add a short `//` on the same line when the field name alone doesn't convey its unit, encoding, or a non-obvious invariant. One phrase, no sentence.

```ts
// ✅ Good — unit is not obvious from the name alone
price: number           // rupees (INR), exactly as Shopify sends
compareAtPrice?: number // absent when no discount exists

// ✅ Good — encoding convention a reader would not guess
washCare?: string[]     // pre-split on Shopify's ## separator
defaultVariantId: string // gid://shopify/ProductVariant/... — merchandiseId for cart

// ✅ Good — deliberately non-standard spelling
occasions?: string[]    // BSC's metafield key is "occassion" (sic) — clean name here

// ❌ Bad — restates what the type already says
id: string              // the product's ID
title: string           // the product title
```

---

## 2. Inline `//` comments — explain non-obvious intent

Write a comment when a reader would stop and ask *"why?"*. If the next line reads naturally on its own, skip it.

**BSC-specific conventions:**

```ts
// BSC's metafield value is "Customisable", not "CUSTOM_DESIGN" — matches prod Shopify
CUSTOMISABLE: 'mtm',

// Shopify metafield key is "occassion" (sic) — do not correct
find(mf, 'custom', 'occassion')

// ## is BSC's line separator in wash_care — not a standard delimiter
.split('##')

// Strip gid://shopify/Product/ prefix — Postgres stores numeric IDs only
gid.split('/').pop()
```

**Defensive logic:**

```ts
// Metafield values from Shopify can be malformed on staging stores
try {
  return JSON.parse(value) as string[]
} catch {
  return []
}

// Return undefined not {} so the frontend doesn't render an empty fabric section
return Object.values(fabric).some(Boolean) ? fabric : undefined
```

**Cache and route decisions:**

```ts
// Self-tag: Shopify SWR cache — no webhook invalidation, tag is the key itself
cachedWithMeta(key, [key], () => fetch(handle), config)

// 404 not 500 — missing product is expected for unpublished handles
throw new NotFoundError(...)
```

**Non-obvious conditions:**

```ts
// compareAt === price means no discount — only spread when there's a real difference
...(hasDiscount && { compareAtPrice: compareAt, discountPercent: ... })
```

A good inline comment explains intent, not mechanics:

```ts
// ❌ Bad — narrates the next line
// Parse the float value
Number.parseFloat(amount)

// ✅ Good — explains the invariant
// Shopify sends INR amounts as decimal strings in rupees, never paise
Number.parseFloat(amount)
```

---

## 3. Handler `//` summary comments — one line above the function

Add a single `//` comment above each exported handler function. Keep it short and human-readable — describe what the route does, not how. Think of it as what you'd say to a teammate: "gets the customer's wishlist", "adds an item and invalidates cache".

```ts
// Returns all wishlisted items for the authenticated customer.
export async function getWishlistHandler(c: Context): Promise<Response> { ... }

// Adds a product/variant to the wishlist — idempotent (safe to call twice).
export async function addItemHandler(c: Context): Promise<Response> { ... }

// Removes by variantId when provided, by productId otherwise (covers null-variant shirts).
export async function removeItemHandler(c: Context): Promise<Response> { ... }

// Merges a guest wishlist into the customer's account on login (up to 500 items).
export async function mergeItemsHandler(c: Context): Promise<Response> { ... }
```

Rules:
- One line only, starting with `//`
- Plain English, no jargon
- Mention the non-obvious behaviour if any (idempotent, fallback logic, limit)
- Skip if the function name + signature already tells the full story

---

## 4. One-line `/** */` docstrings — non-obvious function behavior

When an exported function has a subtle responsibility a reader cannot infer from its name and signature, add a single-line JSDoc. Skip it if the name already tells the whole story.

```ts
/** Transforms raw Shopify product GQL response into the clean BSC domain type. */
export function toProduct(p: ShopifyProduct): Product { ... }

/** Returns null when Shopify has no product for the handle — never throws for missing products. */
export async function fetchProductByHandle(handle: string): Promise<ShopifyProduct | null> { ... }

/** Strips gid://shopify/Product/ prefix — Postgres stores only the numeric segment. */
function stripGid(gid: string): string { ... }
```

Keep it to one line. If you need more, the function is probably doing too much.

```ts
// ❌ Bad — verbose and restates the signature
/**
 * This function takes a ShopifyProduct and transforms it.
 * It maps all the fields and returns a Product object.
 * Used by the products route handler.
 */
export function toProduct(...) { ... }

// ✅ Good — only when behavior is genuinely non-obvious; otherwise omit entirely
export function toProduct(...) { ... }
```

---

## Do not add

- Comments that **restate the code** — `// find the metafield`, `// return the result`, `// map over edges`.
- **Change-log notes** — `// added for PDP`, `// fix for issue #123`, `// refactored`.
- **References to callers or tasks** — `// used by the products module`, `// for the BSC PDP`.
- **Multi-paragraph docstrings** or **multi-line `//` blocks**. One short line max.
- **Decorative dividers** — `// ====`, `// --------`.
- **Author tags** — git blame is authoritative.
- **Commented-out code** — delete it.

---

## Final rule

When in doubt, **skip the comment**. A well-named function and a small scope beat any comment. Only comment where a future reader — who knows TypeScript but not BSC's Shopify conventions — would otherwise have to stop and ask *"why?"*.
