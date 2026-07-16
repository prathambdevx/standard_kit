# build-page — page/component generation from CSS + Figma

Two skills that generate BSC-style components (type + data + component files) from a CSS dump, a
Figma MCP URL, or both — plus the spacing rule they both depend on.

- **`build-page/SKILL.md`** — orchestrates a whole page: reads the layout to skip already-rendered
  chrome (header/footer), plans sections, delegates each section to `component-generator`, integrates
  into the route, runs QA.
- **`component-generator/SKILL.md`** — generates a single component/section: extracts tokens + SVGs
  (via Figma MCP) or layout (via CSS), enforces an accuracy checklist (design tokens only, no raw hex,
  atoms not raw HTML, `<EdgeScroll>` for card rows, `mt-auto` for aligned card footers, **exact
  per-breakpoint aspect ratios — never a reduced fraction**, etc).
- **`rules/spacing.md`** — the padding/gap/margin decision rules both skills read before placing any
  spacing class (gap for sibling spacing, padding for inside a container, margin only for centering /
  EdgeScroll bleed-cancel / a divider needing asymmetric space).

## The aspect-ratio rule (why it's called out)

When the same image renders at different proportions on mobile vs desktop, use one element with two
responsive `aspect-[...]` classes — but **both values must be the literal rendered pixel width/height
from the design at that breakpoint**, never simplified to a common ratio:

```tsx
// ✅ exact design pixels per breakpoint
className="aspect-[342/560] lg:aspect-[684/560]"

// ❌ simplified to a "clean" ratio — loses the actual design proportions
className="aspect-[3/4] lg:aspect-[16/9]"
```

## Adapt before use

Both skills reference a specific folder-structure convention (`.claude/rules/folder_structure.md` —
type/data/component path templates, atom locations) and a specific atom set (`<Img>`, `<Alink>`,
`<Button>`, `<EdgeScroll>`, …) that don't exist yet in a brand-new project. On first run in a new repo,
either:
1. Bootstrap `folder_structure.md` by scanning the project's actual `src/` layout (both skills already
   describe this bootstrap step), or
2. Hand-write it once, matching whatever conventions the new project wants.

Also references `.claude/rules/components.md` (atom table, layout container pattern, cursor rules) and
`.claude/rules/styles.md` (color tokens, typography, Button variants) — neither is bundled here since
they're deeply tied to bsc-platform's specific design system; write the new project's own versions of
those two files, matching the shape these skills expect (a UI-atoms table, a color-token table, a
Button-variants table) so the generation prompts resolve real names instead of guessing.
