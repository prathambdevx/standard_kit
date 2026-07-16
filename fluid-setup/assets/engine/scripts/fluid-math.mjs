/**
 * Fluid rebuild math — SINGLE SOURCE OF TRUTH for the capped-zoom model.
 * Imported by: tailwind-plugins/fluid.js (emission), scripts/check-fluid.mjs
 * (validation), and the invariant tests (fluid-math.test.mjs). The model is locked —
 * read references/model.md in the `fluidize` skill before changing ANY constant.
 */
export const WIDE_FACTOR = 7 / 6; // damped wide zone: ×1.1667 at 1920, frozen beyond
export const FONT_WIDE_LIMIT = 2.5; // WCAG 1.4.4: font wide-max ≤ 2.5·a
export const MAX_GROWTH = 4; // b ≤ 4a, else the min() composition breaks — art-direct such tokens

const r4 = (n) => Math.round(n * 1e4) / 1e4;
const rem = (px) => `${r4(px / 16)}rem`;

export const classify = (a, b, flat = false) =>
  flat ? 'flat' : b < a ? 'inverted' : a === b ? 'fixed' : 'increasing';

export const cap = (a, b) => Math.min((4 * a) / 3, b);

/** The five lines of the curve: value(vw, root) = r·(root/16) + k·(vw/100). */
const lines = (a, b) => {
  const c = cap(a, b);
  return {
    lower: { k: 0, r: a },
    mob: { k: a / 3.6, r: 0 },
    glide: { k: (b - c) / 9.6, r: c - (b - c) / 2 },
    wide: { k: b / 28.8, r: b / 2 },
    freeze: { k: 0, r: WIDE_FACTOR * b },
  };
};

/** Reference value in px. Mirrors the EMITTED expression exactly (incl. root behavior). */
export function evaluate(a, b, vwPx, rootPx = 16) {
  if (b < a) {
    // inverted: frozen single ramp 360→1440 (bounds rem-scaled)
    const t = Math.min(Math.max((vwPx - 360) / 1080, 0), 1);
    const scale = rootPx / 16;
    return (a + (b - a) * t) * scale; // intercept+slope both scale: emitted clamp bounds are rem
  }
  const L = lines(a, b);
  const at = ({ k, r }) => r * (rootPx / 16) + (k * vwPx) / 100;
  const tail = Math.min(at(L.wide), at(L.freeze));
  const desk = b <= 2 * a ? Math.max(at(L.glide), tail) : Math.min(at(L.glide), tail);
  // a === 0: the mob line's slope (a/3.6) is also 0, so it degenerates to a constant-0
  // ceiling instead of a growing one — min(mob, desk) would clamp the whole curve to 0
  // forever. A zero mobile anchor means "invisible in the M-zone" (already true via
  // lower/desk alone), not "capped at zero everywhere" — skip the mob term entirely.
  // Root-scaling quirk unique to a===0: cap(0,b)=0 makes the glide intercept negative
  // (r = c - (b-c)/2 = -b/2), so its rem-scaled term SHRINKS the curve as root grows
  // instead of growing it — e.g. evaluate(0,112,1440,20)===98, evaluate(0,112,1440,24)===84
  // (larger root, smaller value). Not a bug: the anchor-exactness guarantee (=== b at
  // 1440) is root=16-only for this family; monotonicity across vw still holds at every root.
  return a === 0 ? Math.max(at(L.lower), desk) : Math.max(at(L.lower), Math.min(at(L.mob), desk));
}

const term = ({ k, r }) => {
  if (k === 0) return rem(r);
  if (r === 0) return `${r4(k)}vw`;
  return `${rem(r)} + ${r4(k)}vw`; // bare arithmetic is valid inside min()/max()
};

/** CSS expression for a two-value token. Throws on constraint violations. */
export function emit(a, b, opts = {}) {
  const kind = classify(a, b, opts.flat);
  if (kind === 'flat') return rem(a);
  if (kind === 'inverted') {
    // article-form single ramp, frozen outside 360→1440
    const k = (b - a) / 10.8;
    const r = a - (b - a) / 3;
    return `clamp(${rem(Math.min(a, b))}, ${rem(r)} + ${r4(k)}vw, ${rem(Math.max(a, b))})`;
  }
  // a===0 is only a legitimate anchor for SPACING, never for a font. A 0px gap/padding
  // fades in cleanly from 360; a 0px font is invisible and inaccessible — no design
  // ever wants that, so fonts don't get the exemption the two guards below grant spacing.
  if (a === 0 && opts.font)
    throw new Error(`font token 0→${b}: a zero mobile font size is never legitimate`);
  // The 4×/WCAG ratio guards are meaningless at a literal zero (non-font) baseline (any
  // b>0 is "infinite" growth from 0) — a===0 is a legitimate design anchor ("invisible
  // on mobile, appears from the G-zone on"), not a runaway value; skip both for a===0
  // spacing tokens (a font of the same shape already threw above).
  if (a > 0 && b > MAX_GROWTH * a)
    throw new Error(`fl token ${a}→${b} exceeds 4× growth — art-direct or flat it`);
  if (a > 0 && opts.font && WIDE_FACTOR * b > FONT_WIDE_LIMIT * a)
    throw new Error(
      `font token ${a}→${b}: wide max ${r4(WIDE_FACTOR * b)} exceeds 2.5×min (${r4(FONT_WIDE_LIMIT * a)}) — WCAG 1.4.4`,
    );
  const L = lines(a, b);
  const tail = `min(${term(L.wide)}, ${term(L.freeze)})`;
  const desk = b <= 2 * a ? `max(${term(L.glide)}, ${tail})` : `min(${term(L.glide)}, ${tail})`;
  // See the matching a===0 branch in evaluate() — the mob term is a degenerate
  // constant-0 ceiling when a===0, so it's omitted rather than wrapped in min().
  return a === 0
    ? `max(${term(L.lower)}, ${desk})`
    : `max(${term(L.lower)}, min(${term(L.mob)}, ${desk}))`;
}

/** Mobile-only component value: zone-M law alone (proportional, capped 4/3). */
export const emitMobileOnly = (n) => `clamp(${rem(n)}, ${r4(n / 3.6)}vw, ${rem((4 * n) / 3)})`;

/** Desktop-only component value: frozen at n until 1440, damped wide to 1920. */
export const emitDesktopOnly = (n) =>
  `clamp(${rem(n)}, ${rem(n / 2)} + ${r4(n / 28.8)}vw, ${rem(WIDE_FACTOR * n)})`;

/** Art text v2: font sized relative to the copy-column container (the banner pattern —
 *  see fluid-system skill). designPx on a columnDesignPx-wide artboard column → cqw of
 *  the column. No per-element floors: the column's own group floor (width: max(Ncqw, Xpx))
 *  is the only floor, so wrap geometry stays rigid at every size. */
export function emitArtText(designPx, columnDesignPx) {
  if (!(designPx > 0 && columnDesignPx > 0))
    throw new Error('art-text needs [designPx,columnDesignPx] both > 0 (column-relative v2)');
  return `${r4((designPx * 100) / columnDesignPx)}cqw`;
}
