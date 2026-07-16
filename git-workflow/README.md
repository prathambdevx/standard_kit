# git-workflow — commit + pr skills

Two Claude Code skills for turning working-tree changes into clean commits and PRs, monorepo-aware
(platform-scoped Conventional Commits, squash-to-integration-branch flow).

- **`commit/SKILL.md`** — categorizes changes (code/docs/config), splits by platform, writes
  conventional commit messages, stages by name (never `git add -A`).
- **`pr/SKILL.md`** — pushes the branch, generates a platform-scoped title + filled PR template,
  targets the right base branch.

## Adapt before use

Both reference this monorepo's specifics — adjust for the new project:
- **Branch names**: written for `development`/`uat`/`production` (or `dev`/`uat`/`prod` — check which
  your target project actually uses) as the long-lived branches, feature branches → `development`/`dev`.
  A single-branch-flow project (just `main`) needs this section rewritten.
- **Scope list**: the platform scopes (`bff`, `web`, `mobile`, `types`, `cart`, `api-sdk`, …) are this
  monorepo's actual apps/packages — replace with the new project's real workspace names (must match
  `commitlint.config.js`'s `scope-enum` in the `tooling/` folder).
- **PR template reference**: `pr/SKILL.md` reads `.github/PULL_REQUEST_TEMPLATE.md` — create one for the
  new project (Summary / Affected platforms / Changes / Test plan / Checklist sections) or adjust the
  skill to whatever template shape the project uses.

Install: drop each `SKILL.md` into `.claude/skills/commit/` and `.claude/skills/pr/` (or symlink from a
shared `.agents/skills/` dir if the project mirrors multiple AI tools, as bsc-platform does).
