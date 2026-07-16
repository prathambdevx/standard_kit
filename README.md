# standard_kit

My personal, reusable starter kit for new projects — the skills, Claude Code rules, git hooks, and
tooling configs I always want in place, packaged so I can drop them into any new repo instead of
rebuilding them from scratch each time.

**Usage:** copy whichever folder(s) you need into a new project's `.claude/` (skills → `.claude/skills/`,
rules → `.claude/rules/`, hooks → `.claude/hooks/` + wire into `.claude/settings.json`), or point Claude
at this repo and say **"here's my kit, set it up."** Each folder's own `README.md` covers exactly what to
copy where and what to adapt for the new project's actual shape — paths, atom names, branch/scope
conventions differ per repo, but the underlying rules and workflow don't.

## What's in here

| Folder | What it sets up |
|---|---|
| **`git-workflow/`** | Commit + PR skills — platform-scoped Conventional Commits, workspace-aware splitting, PR template filling |
| **`tooling/`** | Lint/format/commit-gate baseline — Biome config, lefthook (pre-commit + commit-msg), commitlint |
| **`comments/`** | Comment-style rules (frontend + backend) + a hook that reminds the model of them right after every edit |
| **`build-page/`** | Page/component generation skills from a CSS dump or Figma MCP URL, plus the spacing-decision rule they depend on |
| **`image-optimization/`** | Next.js image audit skill — correct width/height/sizes/quality/priority, with a savings-estimate report format |
| **`web-conventions/`** | React/Next.js engineering skills — layout-thrashing fixes, state-management decision tree, perf rule pass, hook conventions, 39 react-best-practices rules, App Router patterns, utils-vs-lib placement decision tree |
| **`qa-fix/`** | Visual QA across the standard breakpoint set + a bounded fix→re-QA loop, with a running learnings log |
| **`ui-components/`** | A production atom library (Button/Img/Picture/Alink + accordion/drawer/select/media/video/carousel/…), animation wrappers + motion tokens, scroll-restoration/view-transition helpers, TanStack Query wrapper hooks + provider, string/time/phone utils, and a reusable area-accurate SVG-fill math utility |
| **`ios-safari-fixes/`** | 6 recurring iOS Safari rendering bugs (SVG clipping, `w-auto` cropping, input auto-zoom, `dvh` viewport jump, scroll-lock, safe-area double-stacking) — a skill doc with real before/after fixes + a static validator that catches 4 of them mechanically |
| **`fluid-setup/`** | One-time installer for a fluid (`fl-*`) responsive-scaling system on Tailwind v4 — replaces breakpoint-stepped sizes with two-anchor values that glide smoothly between a mobile and desktop design width |

More kits get added here over time as they prove themselves on real projects.
