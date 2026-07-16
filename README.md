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
| **`fluid-setup/`** | One-time installer for a fluid (`fl-*`) responsive-scaling system on Tailwind v4 — replaces breakpoint-stepped sizes with two-anchor values that glide smoothly between a mobile and desktop design width |

More kits get added here over time as they prove themselves on real projects.
