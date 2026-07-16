# fluid-setup — portable fluid-scaling kit

A self-contained kit that installs a complete **fluid (`fl-*`) responsive scaling system** into any
Tailwind v4 project. Author any size/spacing/font as two design numbers — `fl-text-[14,16]`,
`fl-p-[16,24]`, `fl-gap-[8,12]` — and it glides smoothly from a 360px design width to a 1440px one, then
damps to a ×1.167 ceiling at 1920 and freezes. No breakpoint jumps.

## Use it in a NEW project (two steps)

1. **Copy this whole `fluid-setup/` folder** into the new project's skills directory
   (`.claude/skills/fluid-setup/`).
2. In that project, tell Claude **"set up fluid"** (or run `/fluid-setup`). The installer detects your
   web-app root + CSS entry, copies the engine into place, wires `cn.ts` / `globals.css` / the commit
   gate, and installs the `fluidize` skill + `fluid.md` rule. It verifies by running the 57-test engine
   suite and the validator.

Then, whenever you build or want to convert a page/component:

> **"fluidize the product card"**  ·  **"make the header fluid"**  ·  **"convert the PDP to fl-*"**

…invokes the `fluidize` skill, which converts breakpoint-stepped sizes to `fl-*` following the law.

## What's inside

```
fluid-setup/
  SKILL.md                       the installer (run once per project)
  README.md                      this file
  assets/
    engine/                      copied verbatim into <webRoot>/
      tailwind-plugins/fluid.js  the fl-* Tailwind v4 plugin (matchUtilities)
      scripts/fluid-math.mjs     the locked capped-zoom math — SINGLE source of truth
      scripts/check-fluid.mjs    the validator (WCAG cap, ≤4× growth, input≥16, plugin↔cn sync)
      scripts/*.test.mjs         57 invariant tests (math, plugin, validator)
      lib/cn.ts                  tailwind-merge wiring so fl-* dedupes vs native classes
      styles/fluid.css           the globals.css foundation (@plugin line + optional page-cap)
    skills/fluidize/             the "make X fluid" conversion skill (installed into .claude/skills/)
      SKILL.md                   the law, hard rules, judgment calls, conversion workflow
      references/model.md        the math decision-log (why each constant is what it is)
    rules/fluid.md               always-on quick-reference rule (authored-fluid-from-the-start)
    docs/
      fluid-scaling.html         self-contained interactive demo — live curves + rendered-size tables
      fluid-rebuild-design.md    the original design spec (problem, alternatives, decisions)
    wiring/                      lefthook + package.json + deps snippets to merge
```

Open `assets/docs/fluid-scaling.html` in any browser to *see* the model — the three-zone curve, why
`min(4⁄3·a,b)` beats a naive cap, and a table of what each `[a,b]` token renders at every screen width.

## The model in one paragraph

Two anchors per value: `a` @360px, `b` @1440px. **Zone M** (360→480) zooms proportionally
(`a·vw/360`) capped at `min(4⁄3·a, b)` so it never overshoots `b` and a fixed value never moves.
**Zone G** (cap→1440) glides linearly to `b`, continuous with M (no 768 jump), pixel-exact at 1440.
**Zone W** (1440→1920) grows a damped ×1.167 then freezes. The math is emitted as build-time literal
`clamp()`/`min()`/`max()` expressions with rem-anchored bounds (WCAG 1.4.4 zoom-safe), from ONE module
shared by the plugin, the validator, and the tests — so they can never disagree. Full rationale:
`assets/skills/fluidize/references/model.md`.

## Requirements

- Tailwind **v4** (`@plugin` in the CSS entry + `matchUtilities`).
- Bun (to run the `.mjs` math/validator/tests; the runtime files are otherwise dependency-free).
- `clsx` + `tailwind-merge` (for `cn.ts` — installed by the setup step if missing).
