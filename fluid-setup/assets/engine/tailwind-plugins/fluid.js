/**
 * fl-* — fluid utilities (capped-zoom model). Two Figma numbers per value:
 * `fl-<prop>-[a,b]` where a = value @360px viewport, b = value @1440px.
 * All math lives in scripts/fluid-math.mjs (shared with validator + tests).
 * Law + conversion rules: the `fluidize` skill (.claude/skills/fluidize/SKILL.md).
 * Every family here MUST have a matching entry in FL_NATIVE in src/lib/cn.ts, or
 * tailwind-merge won't dedupe the fl-* class against its native counterpart
 * (the check-fluid validator's plugin-sync cross-check enforces this).
 */
import { emit, emitArtText, emitDesktopOnly, emitMobileOnly } from '../scripts/fluid-math.mjs';

const PROPS = {
  text: (v) => ({ fontSize: v }),
  leading: (v) => ({ lineHeight: v }),
  gap: (v) => ({ gap: v }),
  'gap-x': (v) => ({ columnGap: v }),
  'gap-y': (v) => ({ rowGap: v }),
  w: (v) => ({ width: v }),
  h: (v) => ({ height: v }),
  'min-h': (v) => ({ minHeight: v }),
  'max-w': (v) => ({ maxWidth: v }),
  basis: (v) => ({ flexBasis: v }),
  p: (v) => ({ padding: v }),
  px: (v) => ({ paddingLeft: v, paddingRight: v }),
  py: (v) => ({ paddingTop: v, paddingBottom: v }),
  pt: (v) => ({ paddingTop: v }),
  pb: (v) => ({ paddingBottom: v }),
  pl: (v) => ({ paddingLeft: v }),
  pr: (v) => ({ paddingRight: v }),
  m: (v) => ({ margin: v }),
  mx: (v) => ({ marginLeft: v, marginRight: v }),
  my: (v) => ({ marginTop: v, marginBottom: v }),
  mt: (v) => ({ marginTop: v }),
  mb: (v) => ({ marginBottom: v }),
  ml: (v) => ({ marginLeft: v }),
  mr: (v) => ({ marginRight: v }),
  top: (v) => ({ top: v }),
  bottom: (v) => ({ bottom: v }),
  left: (v) => ({ left: v }),
  right: (v) => ({ right: v }),
  size: (v) => ({ width: v, height: v }),
};

const nums = (value, n) => {
  const parts = String(value)
    .split(',')
    .map((s) => s.trim());
  const xs = parts.slice(0, n).map(Number.parseFloat);
  return xs.length === n && xs.every((x) => Number.isFinite(x))
    ? { xs, rest: parts.slice(n) }
    : null;
};

export default {
  handler: ({ matchUtilities }) => {
    const utilities = {};
    for (const [name, factory] of Object.entries(PROPS)) {
      const isFont = name === 'text';
      utilities[`fl-${name}`] = (value) => {
        const p = nums(value, 2);
        if (!p) return {};
        const [a, b] = p.xs;
        return factory(emit(a, b, { font: isFont, flat: p.rest[0] === 'flat' }));
      };
      utilities[`fl-m-${name}`] = (value) => {
        const p = nums(value, 1);
        return p ? factory(emitMobileOnly(p.xs[0])) : {};
      };
      utilities[`fl-d-${name}`] = (value) => {
        const p = nums(value, 1);
        return p ? factory(emitDesktopOnly(p.xs[0])) : {};
      };
    }
    // Art text (v2, column-relative): px fallback first, cqw value second (array = two
    // declarations in order). No `-m` variant — a column ratio is artboard-agnostic, so
    // a mobile comp just passes its own column's designPx/columnDesignPx pair.
    // Key MUST be the literal CSS property name ('font-size'), not the camelCase JS
    // form ('fontSize') — the object-to-CSS converter only kebab-cases string values;
    // an array value (two declarations, same property) is emitted key-verbatim, so a
    // camelCase key here produces an invalid `fontSize: ...` declaration the browser
    // silently drops.
    utilities['fl-art-text'] = (value) => {
      const p = nums(value, 2);
      if (!p) return {};
      const [design, columnDesign] = p.xs;
      return { 'font-size': [`${design}px`, emitArtText(design, columnDesign)] };
    };
    matchUtilities(utilities, { values: {} });
  },
};
