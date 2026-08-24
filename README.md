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
| **`cms-blocks/`** | Architecture doc for "any CMS block on any page" — one global `__typename → component` registry plus a single catch-all route, replacing per-page view files and block maps. Covers the three layers that must each know every block (CMS dynamic zone, API query union, frontend registry), why per-page variation belongs on a CMS field rather than a code override, a measured take on the performance question (RSC means no client-bundle cost; the real cost is dev HMR, not the prod build), what the pattern rules out, and the migration ordering that breaks page resolution if you get it wrong |
| **`image-optimization/`** | Next.js image audit skill — correct width/height/sizes/quality/priority, with a savings-estimate report format |
| **`web-conventions/`** | React/Next.js engineering skills — layout-thrashing fixes, state-management decision tree, perf rule pass, hook conventions, 39 react-best-practices rules, App Router patterns, utils-vs-lib placement decision tree |
| **`qa-fix/`** | Visual QA across the standard breakpoint set + a bounded fix→re-QA loop, with a running learnings log |
| **`ui-components/`** | A production atom library (Button/Img/Picture/Alink + accordion/drawer/select/media/video/carousel/…), animation wrappers + motion tokens, scroll-restoration/view-transition helpers, TanStack Query wrapper hooks + provider, string/time/phone utils, and a reusable area-accurate SVG-fill math utility |
| **`extras/`** | Optional, not-required-by-default add-ons split out of `ui-components/` — desktop mouse-wheel scroll hook, scroll-linked parallax, and Lenis-powered smooth scroll. Copy in only if a project actually wants that specific enhancement |
| **`optional/`** | Patterns with a real tradeoff to weigh, so never copied in by default (vs `extras/`, which is low-risk nice-to-haves). Currently `virtualization/` — the two scroll-jank tools with the CPU-vs-GPU model that decides between them: `useVirtualization` (CPU: per-item mounted cost — engines, observers, DOM) and `useRailGpuWindow` (GPU: horizontal scrollers rasterise at full scroll width, ~15 MB per 12-card rail; window to 6, expand on the rail's first scroll, collapse off-screen). Includes the full device-measured case study. Each doc leads with the cheaper wins that usually beat it |
| **`ios-safari-fixes/`** | 9 recurring iOS-Safari-and-mobile-Chrome rendering bugs (SVG clipping, `w-auto` cropping, input auto-zoom, `dvh` viewport jump, scroll-lock, safe-area double-stacking, SVG repaint shimmer / position:fixed detachment, address-bar-aware full-screen overlays incl. the on-screen-keyboard `offsetTop + height` measurement, `container-type` co-located with `grid`) — a skill doc with real before/after fixes + a static validator that catches 4 of them mechanically |
| **`fluid-setup/`** | One-time installer for a fluid (`fl-*`) responsive-scaling system on Tailwind v4 — replaces breakpoint-stepped sizes with two-anchor values that glide smoothly between a mobile and desktop design width |
| **`tunnel/`** | Generic multi-service local-dev + Cloudflare-tunnel orchestrator (one shared engine, install once) plus a skill that scaffolds each new project's config — handles the production-vs-dev-mode hydration gotcha, build-time env baking, and cross-service URL/CORS wiring automatically |
| **`pdp-color-swap/`** | In-place PDP colour-swap engine — swap the whole product (gallery/price/info) on a swatch tap with no route remount, via TanStack Query + the View Transitions API for the gallery crossfade. Includes two gallery variants (full grid+carousel+lightbox, and a simpler paired-product layout) and the swatch-row UI |

More kits get added here over time as they prove themselves on real projects.
