---
status: active
date: 2026-07-05
feature: fluid-rebuild
supersedes: 2026-06-23-homepage-fluid-design.md
---
# Fluid Rebuild — Capped-Zoom Design System (Design)

**Date:** 2026-07-05
**Status:** Approved direction — awaiting spec sign-off, then plan
**Scope:** `apps/web` — full replacement of all responsive-scaling CSS
**Supersedes:** `2026-06-23-homepage-fluid-design.md` (record, kept), `2026-06-24-fluid-phase4-theme-scale-design.md`, and the unshipped two-track migration plan (`feat/web-fluid-two-track-jump` branch)
**Decision artifact (interactive demo + evidence):** https://claude.ai/code/artifact/381b18ce-4995-49e1-a2b1-1e686942420d

---

## 1. Problem

Three scaling systems coexist on `dev` and disagree with each other:

| System | Where | Law |
|---|---|---|
| Legacy `--fl-*` vars + `typo-*` utilities | 161 files, 522 usages | linear 360→1440, frozen outside |
| `fluid-*` plugin (three-zone + jump) | 49 files, 285 usages | proportional mobile capped at 4⁄3·a, **drop at 768**, ramp to 1440, wide zone hot-fixed frozen |
| Plain stepped `lg:` classes | PDP (reverted from fluid-*) | breakpoint steps |

Root causes of the "everything feels wrong" verdict (user, 2026-07-04): the plugin's blind `4⁄3·a` mobile cap overshoots desktop values (14px text renders 18.7px on phones), the intentional discontinuity at 768 (values *shrink* as the viewport grows), the `[X,X]` rule that made fixed values "breathe" (24px padding → 32px on phones), and the since-disabled wide zone (×1.5 toward 2160). Mixing three laws on one page produced inconsistent scaling everywhere.

**Decision: scrap and rebuild.** All three systems are replaced by one; the old ones are deleted at the end. No in-place patching.

## 2. The scaling model (locked)

For every scalable value, two inputs — `a` = value at the 360 Figma anchor, `b` = value at the 1440 Figma anchor — harvested from the pre-fluid pixel-perfect CSS (see §6.1). One shared formula derives the full curve. Nothing is hand-tuned per viewport.

For `a ≤ b`:

| Zone | Range | Law | Rationale |
|---|---|---|---|
| **M — mobile zoom** | 360→480 | `a · vw/360`, capped at **`min(4⁄3·a, b)`** | Proportional canvas zoom (user requirement: 12@360 → 14.33@430). The `min(…, b)` term is the core fix: a value never overshoots its own desktop size, and fixed values (`a = b`) are automatically immobile. |
| **G — glide** | cap-point→1440 | linear from the cap value to `b`; junction: glide starts at 480 | Continuous with M by construction — no discontinuity at any width. Pixel-true at 1440. For `b ≤ 4⁄3·a` (most fonts) the glide is flat: the value holds exactly `b` from ~410–480px onward. |
| **W — damped wide** | 1440→1920 | `b · (1 + 0.5·(vw−1440)/1440)` → **×1.167 max at 1920**, frozen beyond | User-validated compromise: full proportional (×1.333) was tested and rejected; freeze felt right but designer wants growth. Damped half-strength applies to everything, body included (physics-validated: ~92 PPI desktop monitors under-render CSS px; 18.7px body at 1920 ≈ the intended visual angle). |

`a > b` (shrinking values, rare): plain single linear ramp 360→1440, frozen outside. `flat` opt-out: hairlines, borders, alignment constants never scale.

**Below 360:** zone M's lower clamp bound holds `a` (no shrinking below the design minimum).

### 2.1 Invariants (validator-enforced, not conventions)

1. **Pixel-true at 360 and 1440** at 16px root — proven by anchor screenshot-diff (§7).
2. **Monotonic + continuous** across 320→2560 for every token — unit-tested.
3. **Continuity at every zone junction for non-default root font-sizes** (16/20/24px roots unit-tested). All zone constants emit rem-anchored; zone G must be composed so its lower edge equals zone M's upper edge *at any root* (e.g. `max(mobile-line, glide-line)` clamped to `b`, not a hard rem floor behind a px media query). The exact emission form is an implementation detail; the root-continuity test is the acceptance gate.
4. **WCAG font cap:** font tokens error at build time if `wide-max > 2.5·a`.
5. **Input floor:** any token applied to text inputs errors if `a < 16` (iOS Safari focus auto-zoom). Note: the shared `Input` atom violates this **today** (`fluid-text-[14,16]`, 16 controls site-wide) — the rebuild fixes a live bug.

## 3. Art text — `cqw` on media-composed banners (locked)

Text **composed into** banner/hero imagery (headline, sometimes subtitle) is part of the artwork and must scale with it, not with the UI curve.

- **v2 — column-relative, not viewport-anchored.** Art text sizes against its own copy column (a nested `container-type: inline-size` box), not a fixed 1440-viewport divisor — `emitArtText(designPx, columnDesignPx)` = `designPx/columnDesignPx` as `cqw`, no per-element clamp. v1 (`design/1440` cqw + a per-element rem floor) shipped with zero usages and was dropped: a margin-inset banner's container isn't the raw viewport (anchor drift), and per-element floors let siblings drift out of proportion and collide (wrap-tower into the artwork).
- **The column carries the one group floor** (`width: max(Ncqw, floorPx)`) — never a per-element font floor. Full pattern, asymmetry rationale, and empirical proof: `apps/web/.claude/skills/fluid-system/SKILL.md` + `references/model.md`.
- CTAs, badges, and prices on the same banner stay on the UI curve (`fl-*`), never `fl-art-text`.
- **WCAG loss-of-content rule:** image + copy grid-stacked in one cell (never `absolute inset-0` for the copy) — the section grows instead of clipping/overlapping at high zoom/large root font; tested at 320px width + 200% zoom + 200% root font-size.
- **Height-bound containers:** `home_hero` couples `aspect-ratio` with `max-h-[100dvh]` — when height binds, width-derived `cqw` no longer tracks the visible crop. Such components size art text against the *binding* dimension (`cqmin`) or document the deviation.

## 4. Page cap 2160 → 1920 + true full-bleed (locked)

- `--page-max: 2160px → 1920px`. Content caps and centers at 1920 (fills a Full-HD screen edge-to-edge — the designer's request, kept).
- **Bands bleed past the cap:** color bands, dark sections, and hero imagery extend to the true viewport edge on >1920 screens; only their *content* stays inside the cap. This requires restructuring `app/layout.tsx` from one whole-page `page-cap` wrapper to the per-section full-width-band/capped-content pattern (bands live inside the capped wrapper today, so 2560 monitors would get hard seams — field research showed zero measured premium sites hard-cap their canvas).
- The fixed header already spans full width and caps its inner row — it becomes the model for every band.
- Punch list from the wide-viewport audit rides along: `deviceSizes`/loader caps and vw-based `sizes` attrs retuned for the 1920 cap; hardcoded `2xl:` values (`pair_product_hero`, `product_hero`, `media_split`) revalidated; customizer two-pane revalidated; SaleMarquee repeat-count checked; rail geometry decision (§6.4).

## 5. Delivery mechanism

### 5.1 New Tailwind plugin — `fl-*` (new prefix, coexists with the old)

- `apps/web/tailwind-plugins/fluid_v2.js` (final name in plan), registered alongside the old plugin during migration. **The old `fluid-*` plugin's math is never modified** — site chrome (Header/Footer/Button) is on it, so an in-place swap would repaint every page at once and destroy page-atomic rollout. The old plugin dies in the purge.
- Same authoring shape: `fl-text-[14,16]`, `fl-p-[16,24]`, `fl-h-[44,60]`; `fl-*-[X,X,flat]` opt-out; art-text family `fl-art-text-[24,40]`; single-anchor variants for mobile-only/desktop-only components (zone-M law alone / frozen-`b`+zone-W alone) replacing `fluid-mob-*`/`fluid-desk-*`.
- All property families from the old `PROPS` map carry over; additions (art-text) documented in the skill.
- Emission is build-time-resolved literal clamps (px→rem at 16), readable in DevTools. (Alternatives were exhaustively red-teamed: fluid.tw/fluid-type plugins express only single linear clamps and fluid.tw lacks Tailwind v4 support; a compiling Tailwind-v4-native `@utility` spike exists and is the documented escape hatch; Utopia step scales break pixel-fidelity. Custom plugin confirmed.)

### 5.2 One math module, three consumers

`apps/web/scripts/fluid-math.ts` (name in plan) exports the zone functions and classification. It is imported by the plugin (emission), the validator (verification), and the unit tests (invariants §2.1). The validator can therefore never disagree with reality — the failure mode that produced 112 false errors on the two-track branch is structurally impossible.

### 5.3 tailwind-merge wiring

`src/lib/cn.ts`: every `fl-*` family registers in its **native Tailwind class group** (`fl-p` conflicts with `p`/`px`/`py`; `fl-text` with `font-size`) via `conflictingClassGroups` — group registration alone dedupes only fl-vs-fl and leaves viewport-dependent half-overrides when old and new classes coexist. `typo-*` is also registered into `font-size` for the transition window.

## 6. Migration

### 6.1 Value harvest

- `a,b` come from the pre-fluid pixel-perfect CSS. **Open task (plan phase):** pin the exact reference git ref; features built after fluid landed have no pre-fluid reference and take values from current Figma.
- The documented typography-audit corrections (`docs/typography-audit/README.md`: `typo-price` Helvetica, wrong line-heights, etc.) are applied during harvest — known-wrong values are not ported.
- Line-heights: unitless ratios (scale with font automatically); letter-spacing in `em`; a fluid px line-height only where the old system had one.

### 6.2 Order of work

| Phase | Content | Gate |
|---|---|---|
| **0a Foundation** | math module + plugin + validator + unit tests + cn.ts wiring + anchor screenshot harness + lefthook gates | all invariant tests green |
| **0b Layout** | page-cap 1920 + per-section cap/bleed restructure + image-pipeline retune | visual pass at 1440/1920/2560 |
| **1 Shared chrome** | Button (baked `typo-xsmall lg:typo-small`), Input (+16px floor fix), Select/DatePicker, CtaLink, ProductCard, Header/Footer, drawers — these leak into every page, so they convert first | chrome-only diff review + anchors |
| **2 Homepage** | full conversion incl. art-text on hero/featured/creators; **designer sign-off on real glass** (24″ 1080p @100% AND a 125%-scaled laptop) | anchor diff + designer approval |
| **3…n Page waves** | PLP → PDP → cart/checkout-adjacent → account → static/CMS pages; one page = one PR; a page is atomically old- or new-system, never mixed | per-page checklist (skill) |
| **Purge** | delete old plugin, `--fl-*`/`--rail-*` vars, `typo-*` utilities, `check-fluid-tokens.ts`, `fluid-refactor`+`fluid-page` skills; rewrite `.claude/rules/styles.md`+`spacing.md`; grep gates flip from warn to error | `rg` clean + full build green |

### 6.3 Known codemod blind spots (from red-team; migration is per-file review, never regex)

Template-literal class fragments (header/footer/home_hero ~40 sites), exported class constants (`Button.shapeStyles`, `ProductCard.CHIP`, `CARD_SLOT` map), classes in props (`EdgeScroll gap=`, weaves `textClassName=`), a class-returning util (`merch_badge`), one inline `style maxHeight` (PDP lightbox). Real `width:100vw` usage in `CARD_SLOT` medium/large — replace while touching (scrollbar rule §6.5).

### 6.4 Rails and grids

- The dormant 1920 rail geometry (`--rail-card-cap` 462px, 4-up) vs the live frozen `fluid-basis-[192,342]` is resolved in the plan: proposal = container-fraction card width with a cap (same container logic as art text). Rail internals move from `--rail-grow` (+2px at 1920) to zone W damped — 1440 screenshots identical, 1920 intentionally differs; noted for designer sign-off.
- PLP 5th column at wide widths: parked as a designer decision; not a blocker.

### 6.5 Standing rules (enforced where possible)

Never `width:100vw` (Windows scrollbar) — full-width via `width:100%` on uncapped wrappers. Fixed-width surfaces (drawers/modals/popovers) use frozen desktop values internally, never viewport units. Layout-mode switches (`hidden lg:flex`, grid↔flex, aspect swaps) stay breakpoints — the fluid system replaces *sizes*, not *structure*. Inputs ≥16px on mobile. `prefers-reduced-motion` untouched (no JS resize coupling anywhere — the system is pure CSS).

## 7. Verification

- **Anchor proof:** Playwright screenshots at 360 and 1440 diffed against the reference build per migrated page (tolerance note: Windows classic scrollbars make real-world 1440 ≈ 1423px usable — diff on macOS overlay-scrollbar rendering, accept ~1% tolerance).
- **Invariant unit tests** (§2.1) on the math module, including root-font-size continuity at 16/20/24px.
- **Validator v2** (from the math module) + lefthook: no `typo-*`, no `var(--fl-`, no raw `clamp()` in components, no `width:100vw`, input-token floor.
- **QA widths per page:** 360 / 393 / 430 / 480 / 768 / 834 / 1024 / 1280 / 1440 / 1536 / 1920 / 2560.
- **CSS budget check:** emitted fluid CSS expected ~10–15KB gzipped at full migration (red-team estimate); measured in phase 0a and at purge.

## 8. Institutional layer — the `fluid-system` skill

`fluid-refactor` and `fluid-page` are **deleted** (they teach the old bugs). One new skill at `apps/web/.claude/skills/fluid-system/` carries the law (SKILL.md), the math rationale + decision log (`references/model.md`), an append-only gotcha log (`references/field-notes.md`), and the page migration tracker (`references/inventory.md`). Self-healing = discipline + machinery: any gotcha found in practice is appended to field-notes in the same PR that hit it (checked at `implementation-workflow` Phase 7 retrospect), while the validator/lefthook/screenshot gates make rule-breaking uncommittable. `.claude/rules/styles.md` and `spacing.md` are rewritten at purge time.

## 9. Out of scope

PLP wide-grid column count (designer, later) · named-token vocabulary layer over recurring pairs (post-migration, additive) · mobile app / BFF / CMS (web only) · any behavior below 320px.

## 10. Evidence trail

Field measurements (6 premium sites, unanimous type-freeze >1440), large-viewport theory (Utopia/Baymard/M3/PPI physics), codebase wide-audit, and the three-lens red-team live in session task outputs `ws7rtlhhl` + `w1mp2p8mo`; the interactive decision demo is the artifact linked in the header. Key math: the rejected "scale to 2160" and the requested "scale to 1920" are identical (×1.333) at a 1920 monitor — the damped ×1.167 zone W is the evidence-based middle.
