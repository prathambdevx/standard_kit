# qa-fix — visual QA at breakpoints + fix loop

Runs after `build-page`/`component-generator`: screenshots (or manually checks) a route across the
standard breakpoint set (320/375/390/414 mobile, 768/820 tablet, 1024/1280 laptop, 1440/1920/2560
desktop), flags overflow/clipping/spacing/typography/max-width issues, offers to fix them
(minimal diffs, max 5 fix→re-QA loops), then asks what was missed and appends it to a running
`LEARNINGS.md` so the skill improves over time.

## Adapt before use

- The breakpoint set and the "must have `2xl:px-0`, width = 1440 not 1328" check assume this
  project's specific container/page-cap convention — adjust both to your own project's actual
  container max-width and breakpoint list.
- Works with or without the Playwright MCP tool; without it, falls back to a manual DevTools
  checklist.
