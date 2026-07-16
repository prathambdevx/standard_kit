---
name: qa-fix
description: Visual QA at breakpoints, fix issues, collect feedback. Use when testing responsive layouts, debugging breakpoint issues, or running post-build visual verification.
user-invocable: true
---

# QA & Fix

Test breakpoints, fix issues, collect feedback. Run after `/build-page` or `/component-generator`.

## Usage

Invoke this skill after building a page or component to test responsive behavior across breakpoints. Uses Read and Grep to inspect component code, Edit and Write to apply fixes, and AskUserQuestion to collect feedback from the user.

## Inputs

| Required | Description |
|----------|-------------|
| Route | Path (e.g., `/men`) or file path |
| URL | Base URL (default: `http://localhost:3000`) |

Optional: breakpoint group (mobile/tablet/laptop/desktop), component selector.

## Breakpoints

| Group | Widths |
|-------|--------|
| Mobile | 320, 375, 390, 414 |
| Tablet | 768, 820 |
| Laptop | 1024, 1280 |
| Desktop | 1440, 1920, 2560 |

## Phase 1: QA

Check each breakpoint for:

| Issue | What to check |
|-------|---------------|
| Overflow | `scrollWidth > clientWidth` |
| Clipping | Elements cut off or disappearing |
| Spacing | Incorrect gaps, padding, margins |
| Typography | Wrong sizes, line-height, alignment |
| Max-width | Content exceeds 1440px |
| 2xl padding | Must have `2xl:px-0` (width = 1440, not 1328) |
| Aspect ratio | Media stretched incorrectly |

**With Playwright MCP:**
- Visit each breakpoint (or specified group)
- Scroll to component if selector provided
- Screenshot each
- Detect overflow via JS
- Do NOT close browser

**Without Playwright:**
```
[ ] DevTools → device toolbar
[ ] Test: 320, 375, 390, 414, 768, 820, 1024, 1280, 1440, 1920, 2560
[ ] Check: overflow, clipping, spacing, typography, max-width
```

**Output:**
```
320px: PASS
375px: FAIL — overflow in HeroSection
768px: PASS
```

Save: `.claude/QA-logs/<date>_<route>_qa.md`

## Phase 2: Fix

Ask: "Fix failing breakpoints? (y/n)"

**Fix rules:**
- Minimal diffs only
- Preserve max-width 1440
- Add `2xl:px-0` on containers
- No `"use client"` unless needed
- No new dependencies
- No new placeholder images

**Common fixes:**

| Issue | Fix |
|-------|-----|
| Overflow | `min-w-0` on flex children, `overflow-hidden` |
| Disappear | Fix `hidden/md:block` logic, `flex-1 min-w-0` |
| Spacing | Adjust `gap-*`, `px-*`, `py-*` |
| Typography | Adjust `text-*`, `leading-*` |
| Max-width | Add `2xl:mx-auto 2xl:max-w-[1440px] 2xl:px-0` |

**Loop:** Fix → Re-QA → Repeat (max 5 iterations)

## Phase 3: Wrap-up

Ask: "Any issues I missed? (paste bullets or 'no')"

If issues provided, append to `.claude/skills/qa-fix/LEARNINGS.md`:
```markdown
---
Date: 2026-03-12
Route: /men
Issues:
- issue description
Component: HeroSection
Breakpoint: 768px
```

## Quick Reference

```bash
/qa-fix /men              # QA the /men route
/qa-fix /men mobile       # Mobile breakpoints only
/qa-fix /men HeroSection  # Scroll to component first
```

## Git Safety

Never commit, push, pull, or modify git config.
