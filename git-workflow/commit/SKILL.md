---
name: commit
description: Use when ready to turn working-tree changes into commits in the bsc-platform monorepo — triggers on "/commit", "commit this", "commit my changes", or finishing a logical sub-piece of work. Covers conventional, platform-scoped commits across apps/* and packages/*.
argument-hint: "optional message override"
user-invocable: true
disable-model-invocation: false
---

# Commit (monorepo)

## Overview

Turn working-tree changes into clean, conventional commits scoped **by platform**
(the app or package changed). One change → one platform → short title → detailed
body. In the monorepo, the commit scope *is* the platform, so a git log reads as
"what shipped on which surface."

## Usage

- `/commit` — auto-detect, categorize, split, and commit
- `/commit feat(mobile): add loyalty row` — commit with the provided first message

## The format

```
type(platform): short imperative title          ← ≤100 chars, lowercase, no period

Detailed description — what changed and why,     ← body, the reasoning a reviewer needs
the context a future reader needs.
```

- **`type`** — kind of change: `feat` · `fix` · `refactor` · `perf` · `docs` · `test` · `chore` · `ci` · `build` · `revert`
- **`platform`** — REQUIRED. The app/package changed:
  `bff` · `web` · `mobile` · `types` · `cart` · `api-sdk`
  + cross-cutting `infra` · `deps` · `ci` · `tooling` · `docs` · `release` · `root`
- **title** — short, imperative, lowercase, no trailing period
- **body** — REQUIRED for `feat`/`fix`/`refactor`/`perf`: explain *what* and *why*. Trivial `chore`/`docs`/`ci` may be subject-only.

### Single platform
```
fix(bff): drop stale variant from PDP cache key

The cache key included optionId, so variant swaps served the wrong
inventory. Key on handle only; variant data is per-response.
```

### Multiple platforms (the ripple case)
When one change touches several workspaces, list each comma-separated in the
scope and break the change down per-platform in the body:
```
feat(types,web,mobile): add loyaltyPoints to product + surfaces

types: +loyaltyPoints field on Product (source of the ripple).
web:   render points badge on PDP.
mobile: show points row on the account screen.
bff:   not touched — field already passed through.
```
The platform list mirrors the roadmap `Scope:` tag and what Turbo's affected-graph
computes — commit, docs, and CI all speak one vocabulary.

## Commit discipline (non-negotiable)

- Each commit is **one logical sub-piece** — with a size-floor. A 1-line dep add or
  a lockfile sync is NOT a standalone commit; fold it into the feature commit it enables.
- **Target 3–5 commits per PR.** If you have 6+, fold prerequisites into their consumer.
- Every commit passes `bun run lint` + `bun run typecheck` on its own (lefthook enforces).
- **Never batch unrelated concerns** in one commit.
- **Never combine categories** (code / docs / config) in one commit — see Flow step 4.

## When to ask the user

Only ask when there's a **real decision** that can't be auto-resolved:
- Unrelated changes found → ask what to do with them
- Type errors in staged files → ask: fix or proceed
- All changes unrelated to the current branch → ask which branch
- Pre-commit hook fails → show the error, stop

Do **NOT** ask for:
- Confirming the commit plan (show it and execute)
- Branch decisions on `development` with config/tooling/doc-only changes (just commit)
- Branch decisions on `development` with code changes (auto-create a branch, don't ask)
- Commit-message confirmation (generate it and use it)

## Flow

### 1. Pre-checks
Run `git status` and `git diff`. Stop if:
- Nothing changed
- Merge conflicts present → tell the user to resolve
- Detached HEAD → tell the user to switch to a branch
- Sensitive files changed (`.env*`, credentials, secrets) → warn and exclude them

If on `development`/`uat`/`production`: docs/config/tooling changes may commit directly.
For **code** changes, auto-create a feature branch (`feat/…`, `fix/…`) — don't ask.

### 2. Categorize changes
Read the current branch → infer its purpose. Assign each changed file to exactly ONE category:
- **Code:** `apps/*/src`, `packages/*/src` — application/package source
- **Docs:** `docs/`, `README.md`, `CONTRIBUTING.md`, per-app `README.md` (not `.claude/`)
- **Config/Tooling:** `.claude/`, `.agents/`, `CLAUDE.md`, `turbo.json`, `*/package.json`,
  `tsconfig*.json`, `biome.json`, `commitlint.config.js`, `.gitignore`
- **Unrelated:** doesn't match the branch purpose AND fits no category above

If files are already staged → respect that grouping; commit only those.

### 3. Handle unrelated changes (ASK)
Only if unrelated changes exist:
> "These look unrelated to `feat/loyalty-points`:
> - `apps/bff/src/services/analytics/tracker.ts`
>
> 1. Stash  2. New branch  3. Include anyway"

If ALL changes are unrelated → ask: commit here, new branch, or cancel.

### 4. Determine platform scope(s)
For each commit, derive the scope from the workspace(s) the files live in:
- `apps/bff/**` → `bff` · `apps/web/**` → `web` · `apps/mobile/**` → `mobile`
- `packages/types/**` → `types` · `packages/cart/**` → `cart` · `packages/api-sdk/**` → `api-sdk`
- root configs/tooling → `tooling`/`root`/`ci`/`deps` as fits
A commit spanning multiple workspaces gets a comma-separated multi-scope (ripple case above).
Keep a multi-platform commit only when the change is genuinely one logical unit; otherwise split.

### 5. Typecheck + execute
- Run `bun run typecheck` (skip for doc-only / config-only commits).
- If type errors in staged files → ASK: fix or proceed.
- Commit **category by category**, never mixed:
  1. Code first (`feat`, `fix`, `refactor`, `perf`)
  2. Docs second (`docs`)
  3. Config/tooling third (`chore`)
- Stage only files from ONE category at a time → commit → next category.
- **Stage files by name** — never `git add .` / `git add -A`.
- Write the detailed body (what + why) for code commits; per-platform breakdown for multi-scope.
- If `$ARGUMENTS` provided → use it as the FIRST commit's message (auto-fix format if close,
  reject if gibberish). Generate messages for the rest.
- If a pre-commit/commit-msg hook fails → show the error, stop.

### 6. Summary
Show the commits made (hashes + messages) and anything still uncommitted.

## Rules

- Conventional commits, platform-scoped: `type(platform): description`.
- Scope is **mandatory** — every commit declares its platform.
- Never commit `.env*`, credentials, or secret files.
- Never bypass hooks (`--no-verify`).
- The changelog is `docs/roadmap.md` — no hand-maintained `CHANGELOG.md`.

## Common mistakes

| Mistake | Fix |
|---|---|
| `git add .` then one big commit | Stage by name; split by category + platform |
| Omitting the platform scope | Always `type(platform): …` — scope is required |
| Mixing code + docs in one commit | Separate commits, code first |
| Subject-only `feat`/`fix` | Add a body: what changed and why |
| Multi-scope for loosely related work | Split into per-platform commits unless it's one logical unit |
