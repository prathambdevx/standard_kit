# tooling — lint, format, and commit-gate baseline

Starter configs for a new project. These are **reference templates from a real monorepo** (bsc-platform)
— copy them in, then trim the project-specific bits (noted below) for the new project's actual shape.

## Files

- **`biome.json`** — Biome (lint + format) config. Single quotes, trailing commas, arrow parens always.
  The `overrides` array is monorepo-specific (per-app rule relaxations for `apps/admin-ui`, import
  restrictions for `apps/web`) — **delete or rewrite the `overrides` entries** for a new project's
  actual app/package layout; keep the base `formatter`/`linter` settings as a sane default.
- **`lefthook.yml`** — git hooks (pre-commit + commit-msg). Ships as a monorepo example wired to a
  specific fluid-scaling toolchain (`fluid-tokens`, `fluid-v2`, `fluid-regression`, `depcruise` gates)
  and `apps/web`-specific paths — **strip the fluid/depcruise commands** for a new project unless it
  also uses the `fluid-setup` kit; keep the `biome` + `typecheck` + `commitlint` shape, it's generic.
- **`commitlint.config.js`** — Conventional Commits enforcement. The `scope-enum` list
  (`bff`, `web`, `mobile`, `types`, `cart`, `api-sdk`, `commerce`, …) is this monorepo's actual
  apps/packages — **replace the scope list** with the new project's real workspace names. Keep
  `type-enum`, `scope-empty`, `subject-case`, and the length rules as-is; they're project-agnostic.

## Install

```bash
bun add -d lefthook @commitlint/cli @commitlint/config-conventional @biomejs/biome
bunx lefthook install
```

Then wire `biome.json` / `lefthook.yml` / `commitlint.config.js` into the project root, adjusted per above.
