# comments — comment-style rules + enforcement hooks

Keeps AI-authored comments minimal and *why*-focused (no restating what the code does, no
change-log-style notes, no decorative dividers) via two channels: a rule Claude reads before writing,
and a PostToolUse hook that reminds it right after an Edit/Write on a matching file.

## Files

- **`rules/comments-web.md`** — comment conventions for React/TSX: JSX section markers, inline `//`
  intent comments, one-line `/** */` docstrings. Do/don't examples for each category.
- **`rules/comments-bff.md`** — comment conventions for backend TypeScript: type-field unit/encoding
  annotations, inline intent comments for non-obvious framework/vendor conventions, one-line handler
  summaries, docstrings for non-obvious exported functions.
- **`hooks/remind-comment-style-web.sh`** — fires after every Edit/Write on a `.tsx`/`.jsx` file;
  injects a pointer to `comments-web.md` into context.
- **`hooks/remind-comment-style-bff.sh`** — fires after every Edit/Write on a backend module/service
  file; injects a pointer to `comments-bff.md`. The path matcher is repo-specific (see below).

## Install in a new project

1. Copy `rules/*.md` → the project's `.claude/rules/`.
2. Copy `hooks/*.sh` → the project's `.claude/hooks/`, `chmod +x` them.
3. Wire both into `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          { "type": "command", "command": ".claude/hooks/remind-comment-style-web.sh" },
          { "type": "command", "command": ".claude/hooks/remind-comment-style-bff.sh" }
        ]
      }
    ]
  }
}
```

## Adapt before use

- `remind-comment-style-bff.sh`'s path matcher (the `case "$FILE_PATH" in ...)` block) hardcodes this
  monorepo's backend paths (`apps/bff/src/modules/*.ts`, `packages/types/src/routes/*.ts`, …) —
  **rewrite the glob patterns** to match the new project's actual backend source layout. If there's no
  separate backend app, delete this hook and its `comments-bff.md` rule entirely; keep only the web one.
- If the new project isn't React/TSX at all, `comments-web.md` doesn't apply — write an equivalent rule
  for whatever language/framework it uses, following the same three-category shape (section markers /
  inline intent comments / doc comments) and drop it in instead.
- Single-app (non-monorepo) projects only need one rule + one hook — merge the two `comments-*.md`
  files into one `comments.md` if there's no meaningful frontend/backend split.
