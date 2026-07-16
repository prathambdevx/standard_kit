---
name: pr
description: Use when ready to open a pull request for the current branch in the bsc-platform monorepo — triggers on "/pr", "open a PR", "create the pull request", or after finishing a branch's work. Covers branch targeting, platform-scoped titles, and filling the PR template.
argument-hint: "optional title override"
user-invocable: true
disable-model-invocation: false
---

# PR (monorepo)

## Overview

Open a pull request for the current branch: push it, generate a platform-scoped
conventional title + a filled template from the branch's commits, and target the
right base. One logical change per PR — single-platform by default, cross-cutting
only when the change genuinely ripples across workspaces.

## Usage

- `/pr` — push, generate, and open the PR
- `/pr feat(mobile): add loyalty row` — open with the provided title

## Rules

- **Target `development`** for everything except `hotfix/*`, which targets `production`.
- **Never** open from (or push to) a long-lived branch (`development`/`uat`/`production`); refuse and tell the user to branch.
- **Title = conventional, platform-scoped** — identical rules to commits (`commitlint.config.js`). Squash-merge makes the PR title the commit on `development`, so it MUST pass commitlint: `type(platform): description`, scope required, comma multi-scope for ripples.
- **Squash-merge** to `development` (one clean commit per PR). Promotions (`dev→uat→prod`) use a **regular merge**, never squash.
- Fill **every** template section, including the **Affected platforms** block.
- Never bypass hooks (`--no-verify`).

## Granularity

| Situation | PR shape |
|---|---|
| Change touches one workspace | Single-platform PR — `feat(mobile): …` |
| One logical change ripples across workspaces | Cross-cutting PR — `feat(types,web,mobile): …`, body breaks it down per platform |
| Several *unrelated* platform changes | **Split** into separate PRs — don't bundle |

## Steps

1. **Check branch** — refuse if on `development`/`uat`/`production`. Tell the user to create a `<type>/<platform>-<desc>` branch.
2. **Determine base** — `production` for `hotfix/*`, else `development`.
3. **`git status`** — warn if there are uncommitted changes (commit first via `/commit`).
4. **Push** — `git push -u origin HEAD` if not already pushed.
5. **Read history** — `git log development..HEAD --oneline` (use the base branch).
6. **Generate title** — derive the scope(s) from the workspaces the branch touched (`apps/bff`→`bff`, `apps/web`→`web`, `apps/mobile`→`mobile`, `packages/types`→`types`, …). Use `$ARGUMENTS` if provided (auto-fix format if close). Multi-scope for ripples.
7. **Generate body** from `.github/PULL_REQUEST_TEMPLATE.md`:
   - **Summary** — what + why, from the commits.
   - **Affected platforms** — the `Scope:` line + table (source-of-ripple vs downstream adapters), same vocabulary as the commits + roadmap.
   - **Changes** — bullets summarizing the commits.
   - **Test plan** — pre-check the boxes that apply (`bun run verify`, scoped tests, migration if `db`-ish).
   - **Checklist** — pre-check Postman (if a `bff` route changed) and the roadmap-step reminder (added at merge, per the docs lifecycle).
8. **Create** — `gh pr create --base <base> --title "<title>" --body "<body>"`.
9. **Output** the PR URL.

## When to ask the user

Only on a real blocker:
- Uncommitted changes present → ask: commit (via `/commit`) or proceed.
- On a long-lived branch → refuse, tell them to branch.
- Push rejected / no `gh` auth → show the error, stop.

Do NOT ask to confirm the title or body — generate and use them.

## Common mistakes

| Mistake | Fix |
|---|---|
| PR base left on `production` (GitHub default) | Flip to `development` (except `hotfix/*`) |
| Non-conventional / unscoped title | `type(platform): …` — it becomes the squash commit |
| Bundling unrelated platform changes | One logical change per PR; split the rest |
| Empty "Affected platforms" | Always fill it — it mirrors commit scopes + roadmap |
