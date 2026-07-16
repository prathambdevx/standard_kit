---
name: layout-thrashing
description: Scan and fix forced reflows, layout thrashing, and DOM read-write interleaving in React/Next.js components. Use when auditing rendering performance, fixing jank, or optimizing scroll/resize handlers.
user-invocable: true
---

# Layout Thrashing Fix

Scan the codebase for forced reflows and layout thrashing, then rewrite the code to fix them.

## What this skill fixes

- **Forced synchronous layout** — reading `offsetHeight`, `getBoundingClientRect`, etc. after a DOM write, forcing the browser to recalculate layout mid-frame
- **Layout thrashing** — read-write-read-write interleaving that causes multiple forced reflows per frame
- **Unbatched DOM reads in loops** — measuring `offsetWidth`, `scrollHeight`, etc. inside `for`/`forEach`/`map`, triggering reflow on every iteration
- **Expensive scroll/resize handlers** — `getBoundingClientRect` or layout reads inside scroll/resize listeners without debounce or `requestAnimationFrame`
- **Forced reflow hacks** — `void el.offsetHeight` tricks used to trigger CSS transitions
- **Layout-triggering style mutations** — direct writes to `width`, `height`, `top`, `left`, `margin`, `padding` instead of CSS transforms

## Example: Before vs After

A sticky header component that reads layout on every scroll event and interleaves reads with writes:

**Before (layout thrashing on every scroll):**
```tsx
const StickyHeader = () => {
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => {
      const header = headerRef.current;
      if (!header) return;

      // READ: forces layout
      const rect = header.getBoundingClientRect();
      // WRITE: invalidates layout
      header.style.top = rect.height > 60 ? "0px" : "-60px";
      // READ again: forced reflow!
      const width = header.offsetWidth;
      // WRITE again: second forced reflow!
      header.style.width = width + "px";
    };

    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return <div ref={headerRef}>...</div>;
};
```

**After (batched reads, RAF-deferred writes, transform instead of top):**
```tsx
const StickyHeader = () => {
  const headerRef = useRef<HTMLDivElement>(null);
  const rafId = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(() => {
        const header = headerRef.current;
        if (!header) return;

        // ALL reads first (single layout calc)
        const rect = header.getBoundingClientRect();
        const width = header.offsetWidth;

        // ALL writes after (no interleaving)
        header.style.transform =
          rect.height > 60 ? "translateY(0)" : "translateY(-60px)";
        header.style.width = width + "px";
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(rafId.current);
    };
  }, []);

  return <div ref={headerRef}>...</div>;
};
```

**What changed:** Reads batched before writes, DOM mutations deferred to `requestAnimationFrame`, `top` replaced with `transform` (composite-only, no layout), scroll listener marked `passive`, RAF cleanup on unmount.

## Usage

```bash
/layout-thrashing                    # Scan entire src/
/layout-thrashing src/components/    # Scan specific directory
/layout-thrashing src/hooks/useScroll.ts  # Scan single file
```

## Critical rule: preserve behavior

**Never remove or change functionality.** The goal is to make existing behavior faster, not different. Every fix must produce the exact same user-visible result. If a layout read is required for correct behavior and cannot be optimized without changing what the user sees, classify it as **(a) safe** and leave it alone.

## What to scan for

Search for these patterns using Grep across the target path:

### 1. Forced layout reads

```
offsetHeight, offsetWidth, offsetTop, offsetLeft
clientHeight, clientWidth, clientTop, clientLeft
scrollHeight, scrollWidth, scrollTop, scrollLeft
getBoundingClientRect, getComputedStyle
innerHeight, innerWidth (on window)
```

### 2. Forced reflow hacks

```
void el.offsetHeight
void element.offsetWidth
el.offsetHeight  // bare read used to force reflow
```

### 3. Layout reads in hot paths

- Inside `for`, `while`, `forEach`, `map`, `reduce`
- Inside `scroll`, `resize`, `mousemove` event handlers
- Inside `setInterval` or `requestAnimationFrame` callbacks that also write

### 4. Read-write-read interleaving

```tsx
// BAD: read -> write -> read
const h = el.offsetHeight;
el.style.height = h + 10 + "px";
const w = el.offsetWidth;  // forces reflow
```

### 5. Style mutations that trigger layout

Direct writes to: `width`, `height`, `top`, `left`, `right`, `bottom`, `margin*`, `padding*`, `border*`, `font-size`, `display`, `position`

## Severity classification

| Level | Meaning | Action |
|-------|---------|--------|
| **(a) Safe** | Single read, no surrounding writes | Document, leave alone |
| **(b) Inefficient** | Repeated reads that could be cached | Cache in variable or `useRef` |
| **(c) Layout thrashing** | Read-write-read pattern or reads in loops/scroll handlers | Must fix |

## Fixing rules

### Never cache absolute scroll positions for dynamic/CMS components

Components rendered by a CMS or dynamic template system (e.g., Blocks in `src/components/Blocks/`) can appear at any position on the page. Content above them may load, resize, or reflow after mount. **Never pre-compute and cache absolute scroll positions** (like `rect.top + window.scrollY`) in a ref — they go stale as the page layout shifts.

Instead, use viewport-relative measurements (`getBoundingClientRect().top`) on each scroll tick inside a RAF callback. A single `getBoundingClientRect` read per frame with no interleaved writes is not layout thrashing — it's one layout calc per frame, which the browser does anyway.

```tsx
// BAD: cached absolute position goes stale when content above loads/resizes
const measureSection = () => {
  const absoluteTop = rect.top + window.scrollY;  // stale after layout shift
  scrollBoundsRef.current = { start: absoluteTop - offset, range };
};
// called once on mount, only re-measured on resize

// GOOD: viewport-relative on every tick, always accurate
const updateProgress = () => {
  const rect = element.getBoundingClientRect();
  const scrollProgress = (viewportHeight * 0.5 - rect.top) / scrollRange;
  // ...
};
// called inside RAF on every scroll — works regardless of component position
```

**When this rule applies:** Any scroll-linked animation or progress calculation in a component that doesn't control its own position on the page (Blocks, dynamic sections, CMS-driven layouts).

### Batch reads before writes

```tsx
// BAD
el.style.width = "100px";
const h = el.offsetHeight; // forced reflow
el.style.height = h + "px";

// GOOD
const h = el.offsetHeight; // all reads first
el.style.width = "100px";  // all writes after
el.style.height = h + "px";
```

### Cache measurements

```tsx
// BAD: reads layout every iteration
items.forEach(item => {
  const rect = container.getBoundingClientRect();
  item.style.top = rect.top + "px";
});

// GOOD: read once, write many
const rect = container.getBoundingClientRect();
items.forEach(item => {
  item.style.top = rect.top + "px";
});
```

### Use `requestAnimationFrame` for DOM writes

```tsx
// BAD: write in scroll handler
onScroll = () => {
  el.style.transform = `translateY(${window.scrollY}px)`;
};

// GOOD: defer write to next frame
onScroll = () => {
  requestAnimationFrame(() => {
    el.style.transform = `translateY(${window.scrollY}px)`;
  });
};
```

### Prefer `IntersectionObserver` over scroll + getBoundingClientRect

```tsx
// BAD
useEffect(() => {
  const handler = () => {
    const rect = el.getBoundingClientRect();
    setVisible(rect.top < window.innerHeight);
  };
  window.addEventListener("scroll", handler);
  return () => window.removeEventListener("scroll", handler);
}, []);

// GOOD
useEffect(() => {
  const observer = new IntersectionObserver(([entry]) => {
    setVisible(entry.isIntersecting);
  });
  observer.observe(el);
  return () => observer.disconnect();
}, []);
```

### Prefer CSS transforms over layout properties

```tsx
// BAD: triggers layout
el.style.top = y + "px";
el.style.left = x + "px";

// GOOD: composite-only, no layout
el.style.transform = `translate(${x}px, ${y}px)`;
```

### Remove forced reflow hacks

```tsx
// BAD: intentional forced reflow
void el.offsetHeight;
el.classList.add("animate");

// GOOD: use requestAnimationFrame double-frame
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    el.classList.add("animate");
  });
});
```

## Output format

For each issue found, output:

```
File: <path>:<line>
Severity: (a) safe | (b) inefficient | (c) layout thrashing
Problem: <short explanation>

Before:
<original code>

After:
<fixed code>

Why: <why the fix works>
```

## Performance estimation reference

Use this table to estimate time saved per fix in the final report. Base cost assumes ~1000 DOM nodes (typical SPA page). Multiply for larger DOMs.

| Fix type | Cost per reflow | Frequency | Estimated savings |
|----------|----------------|-----------|-------------------|
| Scroll/resize handler with layout read | 5-15ms | 60x/sec | **300-900ms/sec of scrolling** |
| `getBoundingClientRect` in loop (N items) | 5-15ms × N | per render | **N × 5-15ms per render** |
| Read-write-read interleaving | 5-15ms per extra reflow | per interaction | **5-50ms per interaction** |
| Uncached repeated read (same value) | 5-15ms each | varies | **5-15ms per extra read** |
| `void el.offsetHeight` hack | 5-15ms | once per trigger | **5-15ms (minor)** |
| Replaced scroll listener with IntersectionObserver | 5-15ms × 60/sec | continuous | **300-900ms/sec (moves off main thread)** |

For the report: calculate based on the actual fixes made. Show per-fix estimates and a total. Be honest — if all fixes were (a) safe, say "no measurable impact expected."

## Flow

1. Grep target path for all layout-triggering property names listed above
2. For each hit, read surrounding code (10-15 lines context)
3. Classify severity (a/b/c)
4. For (b) and (c): rewrite the code using the fixing rules above
5. Run `bun run typecheck` after all fixes
6. Output the final report below

## Final report (MANDATORY)

After all fixes are applied and typecheck passes, you MUST end with this report:

```
╔══════════════════════════════════════════════════════════════╗
║                   LAYOUT THRASHING REPORT                   ║
╠══════════════════════════════════════════════════════════════╣
║ Layout thrashing happens when JavaScript repeatedly reads   ║
║ layout properties (like offsetHeight) and writes styles in  ║
║ the same frame, forcing the browser to recalculate layout   ║
║ multiple times instead of once — causing jank and lag.      ║
╠══════════════════════════════════════════════════════════════╣
║ Files scanned:        N                                     ║
║ Total issues found:   N                                     ║
║                                                             ║
║ (c) Layout thrashing: N  → N fixed                          ║
║ (b) Inefficient:      N  → N fixed                          ║
║ (a) Safe (no action): N                                     ║
╠══════════════════════════════════════════════════════════════╣
║ ESTIMATED PERFORMANCE IMPACT:                               ║
║ - Scroll handler fix: ~300-900ms/sec saved (was 60 reflows) ║
║ - Loop measurement fix: ~100-300ms saved per render         ║
║ - Batched reads: ~10-50ms saved per interaction             ║
║ - Total estimated savings: ~Xms per interaction/scroll      ║
╠══════════════════════════════════════════════════════════════╣
║ FILES MODIFIED:                                             ║
║ - src/components/Foo/Bar.tsx  (2 fixes)                     ║
║ - src/hooks/useScroll.ts      (1 fix)                       ║
║                                                             ║
║ MOST CRITICAL FIX:                                          ║
║ <one-line description of worst issue>                       ║
║                                                             ║
║ REMAINING ACCEPTABLE READS:                                 ║
║ - src/path.tsx:42 — <reason it's safe>                      ║
║                                                             ║
║ TYPECHECK: ✓ PASSED                                         ║
╚══════════════════════════════════════════════════════════════╝
```

If no issues were found:
```
╔══════════════════════════════════════════════════════════════╗
║                   LAYOUT THRASHING REPORT                   ║
╠══════════════════════════════════════════════════════════════╣
║ Layout thrashing happens when JavaScript repeatedly reads   ║
║ layout properties and writes styles in the same frame,      ║
║ forcing the browser to recalculate layout — causing jank.   ║
╠══════════════════════════════════════════════════════════════╣
║ Files scanned: N                                            ║
║ No layout thrashing issues found.                           ║
╚══════════════════════════════════════════════════════════════╝
```
