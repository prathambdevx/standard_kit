#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
[ -z "$FILE_PATH" ] && exit 0

# Leading * so the patterns match the absolute file_path the hook receives.
case "$FILE_PATH" in
  *apps/bff/src/modules/*.ts|\
  *apps/bff/src/modules/*/*.ts|\
  *apps/bff/src/services/*.ts|\
  *apps/bff/src/services/*/*.ts|\
  *apps/bff/src/services/*/*/*.ts|\
  *packages/types/src/routes/*.ts) ;;
  *) exit 0 ;;
esac

MSG="Comment-style check for $FILE_PATH: verify comments follow .claude/rules/comments-bff.md — type field inline // for units/encoding/sic spellings, inline // only for non-obvious BSC/Shopify conventions or defensive logic, one-line /** */ docstring only for non-obvious exported function behavior. Never restate what the code already says."

jq -n --arg msg "$MSG" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $msg
  }
}'
exit 0
