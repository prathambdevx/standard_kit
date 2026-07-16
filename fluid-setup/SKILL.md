---
name: fluid-setup
description: One-time installer for the fluid (fl-*) responsive scaling system. Run ONCE per project when setting it up — it drops the Tailwind plugin, shared math module, validator, cn.ts tailwind-merge wiring, globals.css foundation, commit gate, and the `fluidize` conversion skill + `fluid.md` rule into place. After it runs, "fluidize <page>" / "make <component> fluid" just works. Triggers on "set up fluid", "install the fluid system", "bootstrap fluid", "/fluid-setup".
---

# Fluid setup — install the fl-* system into this project

This installs a complete, self-contained fluid-scaling system: two-anchor `fl-*` utilities
(`fl-text-[14,16]`, `fl-p-[16,24]`, …) that glide smoothly between a 360px and a 1440px design width,
then damp to a ×1.167 ceiling at 1920 and freeze. Everything needed ships in this skill's `assets/`.

**Run this ONCE per project.** After it completes, the `fluidize` skill and the `fluid.md` rule are in
place, and converting any page/component is a matter of "fluidize this."

## Preconditions (check first, stop if unmet)

- **Tailwind v4** (the plugin uses `@plugin` in the CSS entry + `matchUtilities`). Confirm `tailwindcss@^4`
  in package.json. If it's Tailwind v3, stop and tell the user — the `@plugin` CSS mechanism differs.
- **Bun** (the math/validator/tests are `.mjs` run via `bun`; `bun test` runs the suite). If the project
  uses node/npm/pnpm, the runtime files still work but adjust the script commands accordingly and say so.
- **A `cn`-style className combiner is expected** but not required up front (this installs one if absent).

## Guard against double-install

Before touching anything, check whether the system is already present:
- Does `<webRoot>/tailwind-plugins/fluid.js` exist? Does the CSS entry already `@plugin ".../fluid.js"`?
- Is `fl-text-[14,16]` already a working class (grep for existing `fl-*` usages)?

If any of these is true, **stop and report** what's already installed — do not clobber. Offer to only
fill in the missing pieces (e.g. install just the `fluidize` skill, or add the commit gate).

## Step 0 — locate the web app root and CSS entry (confirm with the user)

Detect `<webRoot>` = the directory that will hold `tailwind-plugins/`, `scripts/`, and whose `src/`
contains components. Find it by locating the Tailwind CSS entry (`@import "tailwindcss"` — often
`src/styles/globals.css`, `src/app/globals.css`, or `app/globals.css`) and the nearest `package.json`
with `tailwindcss`. **State the detected `<webRoot>` and CSS-entry path and confirm** before writing.

## Step 1 — copy the engine files (verbatim)

From this skill's `assets/engine/`, copy into `<webRoot>`:

| From (assets/engine/) | To (`<webRoot>/`) |
|---|---|
| `tailwind-plugins/fluid.js` | `tailwind-plugins/fluid.js` |
| `scripts/fluid-math.mjs` | `scripts/fluid-math.mjs` |
| `scripts/check-fluid.mjs` | `scripts/check-fluid.mjs` |
| `scripts/fluid-math.test.mjs` | `scripts/fluid-math.test.mjs` |
| `scripts/check-fluid.test.mjs` | `scripts/check-fluid.test.mjs` |
| `scripts/fluid-plugin.test.mjs` | `scripts/fluid-plugin.test.mjs` |

These are project-agnostic — copy byte-for-byte. The scripts assume the layout
`<webRoot>/{scripts,tailwind-plugins}/` and `<webRoot>/src/lib/cn.ts`; if the project's `cn` lives
elsewhere, update the `CN_FILE` URL near the bottom of `check-fluid.mjs`.

## Step 2 — install / merge `cn.ts` (the tailwind-merge wiring — the careful step)

The `fl-*` classes must be taught to tailwind-merge so an `fl-*` class dedupes against the native class it
overrides (`cn('p-4','fl-p-[16,24]')` → keeps only `fl-p`). `assets/engine/lib/cn.ts` is a complete,
`fl-*`-only `cn` implementation.

- **If the project has NO `cn` helper:** copy `assets/engine/lib/cn.ts` → `<webRoot>/src/lib/cn.ts`.
- **If the project ALREADY has a `cn`** (common): do **not** overwrite it. MERGE the fluid machinery into
  it — copy the `Validator`/`arb`, `FL_NATIVE`, `STOCK_AXES`, `FL_PROP_OF`, `flVariants`, `flClassGroups`,
  `flConflicts`, `addConflict`, and the two `for` loops + the `fl-art-text` block from the bundled file,
  and fold `classGroups: flClassGroups` / `conflictingClassGroups: flConflicts` into their existing
  `extendTailwindMerge({ extend: { … } })` call (preserving whatever else they already extend). Keep their
  existing exported `cn`. Verify with a quick check that `cn('p-4','fl-p-[16,24]')` returns only `fl-p-[16,24]`.

The `check-fluid` validator's plugin-sync check enforces that every plugin `PROPS` family has a matching
`FL_NATIVE` entry — run it (Step 6) to confirm the merge is complete.

## Step 3 — wire globals.css

In the Tailwind CSS entry, right after `@import "tailwindcss";`, add the `@plugin` line from
`assets/engine/styles/fluid.css`, with the path adjusted to point from the CSS file to the copied
`tailwind-plugins/fluid.js` (compute the relative path — from `src/styles/globals.css` it's
`../../tailwind-plugins/fluid.js`). Optionally also add the `--page-max` + `page-cap` block from that file
if the user wants an automatic page cap. **Do not** add any `--fl-*` token `:root` block — the fl-* system
is inline and needs none.

## Step 4 — install the `fluidize` skill + the `fluid.md` rule

- Copy `assets/skills/fluidize/` → the project's skills dir (`.claude/skills/fluidize/`, or
  `<webRoot>/.claude/skills/fluidize/` in a monorepo where skills are app-scoped). This is the
  "make X fluid" conversion skill; its `references/model.md` carries the locked math rationale.
- Copy `assets/rules/fluid.md` → the project's rules dir (`.claude/rules/fluid.md`). Wire it into how the
  project loads rules: if it uses `paths:`-scoped rule frontmatter, add a `paths:` block matching the UI
  source glob; otherwise add a one-line pointer to it from the project's CLAUDE.md so it's always in context.
- Reference docs travel with the kit in `assets/docs/` (`fluid-scaling.html` — a self-contained interactive
  demo of the curves; `fluid-rebuild-design.md` — the design rationale). Offer to copy the HTML demo into
  the project (e.g. `docs/` or a `public/` dir) so the team can open it in a browser; it's optional.

## Step 5 — wire the commit gate + package scripts + deps

- Merge the gate from `assets/wiring/lefthook-snippet.yml` into the project's `lefthook.yml` (or the
  equivalent pre-commit/CI runner) so `bun scripts/check-fluid.mjs {staged_files}` runs on every change to
  component/plugin source.
- Add the `check:fluid` + `test:fluid` scripts from `assets/wiring/package-scripts.md` to the web
  package.json.
- Ensure `clsx` + `tailwind-merge` are installed (`bun add clsx tailwind-merge` if missing).

## Step 6 — verify (do not skip; report the results)

- `bun test <webRoot>/scripts/fluid-math.test.mjs <webRoot>/scripts/check-fluid.test.mjs <webRoot>/scripts/fluid-plugin.test.mjs`
  → all pass (57 tests). This proves the engine copied intact.
- `bun run check:fluid` (or `bun <webRoot>/scripts/check-fluid.mjs`) → exits 0 (no fl-* usages yet, or all valid).
- Add a throwaway `fl-text-[14,16]` to a component, run the build/dev server, and confirm it compiles and
  the class produces a `clamp(...)`/`min()`/`max()` font-size in the DOM. Remove it.
- Typecheck the merged `cn.ts`.

## Step 7 — hand off

Tell the user setup is complete and that they can now say **"fluidize &lt;page/component&gt;"** (invokes the
`fluidize` skill) to convert existing UI, or author new UI with `fl-*` directly (the `fluid.md` rule keeps
the law in context). Point them at `fluidize`'s `references/model.md` for the deep math.

---

## Notes for the installer (you, running this)

- This is an installer that WRITES files into a target project. Read `assets/` for the exact contents.
- Copy engine files verbatim (they're tested as a unit); only globals.css, cn.ts (merge case), lefthook,
  and package.json are project-specific edits.
- If run inside THIS kit's own repo (which already has a more complex legacy-coexistence fluid setup),
  the double-install guard should fire — do not re-run it here.
