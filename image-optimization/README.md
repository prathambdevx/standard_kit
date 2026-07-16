# image-optimization

Audit + fix skill for Next.js `<Image>`-based components: right `width`/`height` (CSS rendered size,
not source/CMS size), `sizes` for responsive grids, `quality` by image role, `priority` only above the
fold. Includes a savings-estimate report format for before/after audits.

## Adapt before use

`SKILL.md` documents a specific `<Img>`/`<Picture>` wrapper API (`src/components/ui/img.tsx` /
`picture.tsx` — 2x DPR loader, `showLoader` spinner-gated lazy load, `preloadImage` helper) as the
worked example throughout. The **principles and tables are universal** (rendered-size-not-source-size,
sizes-is-the-biggest-lever, quality-by-role, priority-only-above-fold) — but if the new project's image
component doesn't have this exact prop surface, either:
1. Build an equivalent wrapper first (2x DPR loader + `sizes` passthrough is the core of it), or
2. Rewrite the "How the Img Component Works" section to describe whatever component the project
   actually has, keeping the rest of the skill (workflow, rules, checklist, report format) as-is.
