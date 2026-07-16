---
paths: ["**/*.tsx", "**/*.jsx"]
---

# Comment style for React components

Keep comments short, human-readable, and focused on *why* — not *what*. Add them only where they help a reader; default to no comment.

Three categories of comments are welcome: **JSX section markers**, **inline `//` intent comments**, and **one-line `/** ... */` docstrings**. Everything else is noise.

---

## 1. JSX section markers — label logical blocks

Use a one-or-two-word `{/* ... */}` label above a group of related JSX. Think of them as in-file table-of-contents entries — a reader scrolling the file should be able to find each region instantly.

```tsx
{/* Header */}
<header className="flex items-center justify-between">
  <h1>Settings</h1>
  <Avatar user={user} />
</header>

{/* Filter chips */}
<div className="flex flex-wrap gap-2">
  {filters.map((f) => <Chip key={f.id} {...f} />)}
</div>

{/* Empty state — only when filters return nothing */}
{results.length === 0 && (
  <p className="py-12 text-center text-sm text-gray-500">No matches.</p>
)}

{/* Sticky CTA — hidden on desktop */}
<div className="fixed bottom-0 md:hidden">
  <Button>Continue</Button>
</div>
```

A good section marker labels the *role*, not the *element*:

```tsx
// ❌ Bad — restates the tag
{/* Button */}
<button onClick={onSubmit}>Continue</button>

// ✅ Good — labels the role in the layout
{/* Primary CTA */}
<button onClick={onSubmit}>Continue</button>
```

---

## 2. Inline `//` comments — explain non-obvious intent

Explain *why* a step exists, what edge case it handles, or what constraint a number/condition encodes. If the next line reads naturally on its own, skip the comment.

**Effects and timers:**

```tsx
// Debounce raw input — avoids re-filtering on every keystroke
useEffect(() => {
  const id = setTimeout(() => setDebouncedQuery(rawQuery), 300);
  return () => clearTimeout(id);
}, [rawQuery]);

// Pause auto-rotation on hover so the user can finish reading
useEffect(() => {
  if (isHovered) return;
  const id = setInterval(advance, 4000);
  return () => clearInterval(id);
}, [isHovered]);

// Auto-dismiss toast after 3s; clear timer if a new toast arrives first
useEffect(() => {
  if (!toast) return;
  const id = setTimeout(() => setToast(null), 3000);
  return () => clearTimeout(id);
}, [toast]);
```

**Conditions and clamping:**

```tsx
// Clamp to [1, stock] and never exceed the per-order cap
const next = Math.min(MAX_PER_ORDER, stock, current + delta);

// Free shipping kicks in once the cart subtotal crosses the threshold
const qualifiesForFreeShipping = subtotal >= FREE_SHIPPING_THRESHOLD;

// On the last step "next" becomes "submit" instead of advancing
if (step === "review") {
  submit();
  return;
}
```

**Async and error paths:**

```tsx
// Optimistic update — roll back if the server rejects the change
setLikes((n) => n + 1);
try {
  await api.like(id);
} catch {
  setLikes((n) => n - 1);
}

try {
  const parsed = JSON.parse(saved);
  applySaved(parsed);
} catch {
  // Corrupted JSON — drop the saved selection silently
}
```

**Accessibility and platform quirks:**

```tsx
// Defer focus to next frame so screen readers announce the new modal
requestAnimationFrame(() => closeButtonRef.current?.focus());

// Safari needs an explicit blur before re-focusing the same input
inputRef.current?.blur();
inputRef.current?.focus();
```

A good inline comment explains *intent*, not *mechanics*:

```tsx
// ❌ Bad — narrates the next line
// Set isLoading to true
setIsLoading(true);

// ✅ Good — explains why it matters
// Show skeleton while the slow analytics call resolves
setIsLoading(true);
```

```tsx
// ❌ Bad — restates the condition in English
// Show toast if toast is not null
{toast && <Toast>{toast}</Toast>}

// ✅ Good — explains the lifecycle
{/* Toast — bottom-anchored, auto-dismisses after 3s */}
{toast && <Toast>{toast}</Toast>}
```

---

## 3. One-line `/** ... */` docstrings — non-obvious component behavior

When a component has a subtle responsibility a reader cannot infer from its name and props, prefix it with a single-line JSDoc. Skip the docstring if the name already tells the whole story.

```tsx
/** Waits for store hydration before rendering so filters initialize with the correct values. */
export const FilterableList = (props: Props) => { ... };

/** Multi-step signup wizard with per-step validation; advancing is blocked until the current step is valid. */
export const SignupWizard = () => { ... };

/** Synchronizes selection with localStorage so a refresh keeps the user's choice. */
export const ProductCard = (props: Props) => { ... };
```

Keep it to one line. If you need more than a sentence, the component is probably doing too much — split it instead.

```tsx
// ❌ Bad — verbose and restates the code
/**
 * This component renders a button.
 * When clicked, it calls the onClick handler passed in props.
 * It also supports a disabled state.
 */
export const SubmitButton = (...) => ...;

// ✅ Good — only when behavior is genuinely non-obvious; otherwise omit entirely
export const SubmitButton = (...) => ...;
```

---

## Do not add

- Comments that **restate the code** — `// set state`, `// return jsx`, `// import react`.
- **Change-log style notes** — `// added X`, `// fix for issue #123`, `// removed Y`, `// TODO from last week`.
- **References to callers / tasks / PRs** — `// used by Foo`, `// for the new checkout flow`, `// per PM request`.
- **Multi-paragraph docstrings** or **multi-line `//` blocks**. One short line max.
- **Decorative dividers** — `// ====`, `// --------`, ASCII boxes.
- **Author tags** — `// @author Jane`. Git blame is authoritative.
- **Commented-out code**. Delete it; git remembers.

---

## Final rule

When in doubt, **skip the comment**. A clear identifier and a small function beat any comment. Good code reads top-to-bottom and only needs a comment where a reader would otherwise have to stop and ask *"why?"*.
