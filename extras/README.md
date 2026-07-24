# extras — optional, NOT required by default

Everything in this folder is split out of the `ui-components` kit specifically because it is
**not needed for that kit's atoms to work.** Nothing in `ui-components` imports from here. Copy a
file in only when a project actually wants the specific enhancement it provides — otherwise skip
this folder entirely.

## What's in here

| File | What it is | Only copy it if… |
|---|---|---|
| `hooks/useHorizontalScroll.ts` | Makes a scroll-snap row respond to a plain desktop mouse wheel (no trackpad, no touch) — detects a real wheel vs. a trackpad pan via `deltaMode`/`wheelDeltaY`, eases via `requestAnimationFrame` | …the project wants desktop-mouse-wheel scrolling on a card rail. `ui-components`'s own `edge_scroll/index.tsx` does **not** wire this in — trackpad and touch already scroll it natively; this is purely a bonus for a plain desktop mouse with no trackpad. Wire it into `edge_scroll` (or your own rail) yourself via a merged ref if wanted |
| `hooks/useParallax.ts` | Scroll-linked vertical translate for a layer inside an `overflow-hidden` frame; honors `prefers-reduced-motion` | …a design specifically calls for parallax drift on editorial imagery. Purely decorative — nothing else depends on it |
| `components/transitions/parallax/index.tsx` | `<Parallax>` — the wrapper component built on `useParallax` above | …pairs with the hook above; same condition |
| `components/transitions/smooth_scroll/index.tsx` | `<SmoothScroll>` — mounts Lenis momentum smooth-scrolling for the page's lifetime | …the project specifically wants Lenis-style momentum/inertia scrolling site-wide. Peer dependency: `lenis`. This changes the page's global scroll feel — a real product decision, not a default to reach for |

## Install

Same convention as `ui-components`: drop `hooks/*.ts` into `src/hooks/`, `components/transitions/*`
into `src/components/transitions/`. `parallax/index.tsx` imports `useParallax` from `@/hooks/useParallax`
and `cn` from `@/lib/cn` — both resolve automatically if you use the standard `@/*` → `src/*` alias.

`parallax/index.tsx` and `smooth_scroll/index.tsx` both read the shared motion tokens from
`ui-components/components/transitions/motion.css` — that file stays in `ui-components` (it's not
extras-only; `<RevealUp>`/`<RevealOnScroll>` need it too), so merge it into your `globals.css`
regardless of whether you copy anything from this folder.

## Why these are separated out, not just marked optional in `ui-components`

Keeping `ui-components` itself free of anything with a real judgment call (does this page want
parallax? does this site want Lenis?) or a hook nothing else there depends on keeps that kit a
"copy the whole thing, wire the alias, done" experience. `extras/` is the opposite: read the
"Only copy it if…" column and decide per-project before touching any of it.
