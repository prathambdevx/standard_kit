#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
[ -z "$FILE_PATH" ] && exit 0

case "$FILE_PATH" in
  *.tsx|*.jsx) ;;
  *) exit 0 ;;
esac

MSG="Comment-style check for $FILE_PATH: verify comments follow .claude/rules/comments-web.md — JSX section markers like {/* Title */} above logical layout blocks, inline // comments only for non-obvious intent (the *why*), short /** ... */ docstring only for non-obvious component behavior. Never add comments that restate what the code obviously does."

jq -n --arg msg "$MSG" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $msg
  }
}'
exit 0
