import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

type Validator = (value: string) => boolean;
const arb: Validator = () => true;

// Teach tailwind-merge about the fl-* plugin utilities (tailwind-plugins/fluid.js).
// Each fl-<prop> family is registered as its OWN class group (not folded into its
// native counterpart) so it can be wired into conflictingClassGroups. Each family
// must behave EXACTLY like the native group it styles, in both directions — without
// this, `cn('p-4', 'fl-p-[16,24]')` would keep BOTH classes and whichever won would
// flip with the viewport (the plugin's clamp expression vs the static class).
// KEEP IN SYNC with PROPS in tailwind-plugins/fluid.js (the check-fluid validator
// cross-checks this — every PROPS key must appear here).
const FL_NATIVE: Record<string, string> = {
  text: 'font-size',
  leading: 'leading',
  gap: 'gap',
  'gap-x': 'gap-x',
  'gap-y': 'gap-y',
  w: 'w',
  h: 'h',
  'min-h': 'min-h',
  'max-w': 'max-w',
  basis: 'basis',
  p: 'p',
  px: 'px',
  py: 'py',
  pt: 'pt',
  pb: 'pb',
  pl: 'pl',
  pr: 'pr',
  m: 'm',
  mx: 'mx',
  my: 'my',
  mt: 'mt',
  mb: 'mb',
  ml: 'ml',
  mr: 'mr',
  top: 'top',
  bottom: 'bottom',
  left: 'left',
  right: 'right',
  size: 'size',
};

// Stock tailwind-merge axis hierarchy — verbatim from getDefaultConfig()'s
// conflictingClassGroups (dist/bundle-mjs.mjs), restricted to axes an fl family
// participates in. key = broad group; value = the narrower groups a LATER `key`
// class removes. One-way by construction: narrow never removes broad (a later
// pt-8 only partially overrides py-2, so both must survive — removing py would
// lose bottom padding). The fl wiring below derives every edge from this table
// so fl-* mirrors stock exactly instead of hand-enumerating directions.
const STOCK_AXES: Record<string, string[]> = {
  inset: ['inset-x', 'inset-y', 'start', 'end', 'top', 'right', 'bottom', 'left'],
  'inset-x': ['right', 'left'],
  'inset-y': ['top', 'bottom'],
  flex: ['basis', 'grow', 'shrink'],
  gap: ['gap-x', 'gap-y'],
  p: ['px', 'py', 'ps', 'pe', 'pt', 'pr', 'pb', 'pl'],
  px: ['pr', 'pl'],
  py: ['pt', 'pb'],
  m: ['mx', 'my', 'ms', 'me', 'mt', 'mr', 'mb', 'ml'],
  mx: ['mr', 'ml'],
  my: ['mt', 'mb'],
  // One-way in stock (measured): later size-4 removes w-8; later w-8 keeps size-4.
  size: ['w', 'h'],
  // Deliberate stock deviation: no 'font-size': ['leading'] — fl-text sets ONLY
  // font-size (unlike native text-* which re-declares line-height), so removing an
  // earlier leading-* would delete a declaration nothing replaces.
};

// Native group id → fl prop suffix (inverse of FL_NATIVE; only `text` differs).
const FL_PROP_OF: Record<string, string> = Object.fromEntries(
  Object.entries(FL_NATIVE).map(([name, group]) => [group, name]),
);
// The three utility families sharing one prop: continuous + mobile/desktop single-anchor.
const flVariants = (prop: string) => [`fl-${prop}`, `fl-m-${prop}`, `fl-d-${prop}`];

const flClassGroups: Record<string, Array<Record<string, Validator[]>>> = {};
const flConflicts: Record<string, string[]> = {};
const addConflict = (id: string, target: string) => {
  const targets = flConflicts[id] ?? [];
  flConflicts[id] = targets;
  if (!targets.includes(target)) {
    targets.push(target);
  }
};

for (const [name, native] of Object.entries(FL_NATIVE)) {
  const family = flVariants(name);
  for (const variant of family) {
    flClassGroups[variant] = [{ [variant]: [arb] }];
  }
  // A later fl-<name> removes: its exact native group, the native group's stock
  // descendants, and the fl families of those descendants (broad removes narrow).
  const children = STOCK_AXES[native] ?? [];
  const flDescendants = children.flatMap((child) =>
    FL_PROP_OF[child] ? flVariants(FL_PROP_OF[child]) : [],
  );
  for (const source of family) {
    for (const target of [native, ...children, ...flDescendants]) {
      addConflict(source, target);
    }
    // g/m/d dedupe against each other (continuous-scale vs single-anchor siblings).
    for (const sibling of family) {
      if (sibling !== source) {
        addConflict(source, sibling);
      }
    }
  }
  // Reverse identity: a later exact native removes the whole fl family.
  for (const variant of family) {
    addConflict(native, variant);
  }
}

// Reverse hierarchy: a later broad NATIVE also removes the fl families of its stock
// descendants — p-4 removes fl-px/fl-pt…, and broads with no fl counterpart still
// remove fl leaves (inset-0 removes fl-bottom, flex-1 removes fl-basis). Narrow
// natives get no edge to broad fl families, mirroring stock's one-way lists.
for (const [broad, children] of Object.entries(STOCK_AXES)) {
  for (const child of children) {
    const prop = FL_PROP_OF[child];
    if (prop) {
      for (const variant of flVariants(prop)) {
        addConflict(broad, variant);
      }
    }
  }
}

// The justified half of stock's font-size→leading edge: a later native text-* DOES
// set line-height, so it legitimately removes an earlier fl-leading — but never the
// reverse (fl-text is font-size-only; see the STOCK_AXES deviation note).
for (const variant of flVariants('leading')) {
  addConflict('font-size', variant);
}

// fl-text additionally removes fl-art-text.
addConflict('fl-text', 'fl-art-text');

// fl-art-text (column-relative art text) — one literal utility name; no `-m` sibling
// to dedupe against (a column ratio is artboard-agnostic, so there's only ever one
// family — see fluid.js). It acts as a font-size family: bidirectional with native
// font-size, and, also font-size-only, never removes line-height classes.
flClassGroups['fl-art-text'] = [{ 'fl-art-text': [arb] }];
addConflict('fl-art-text', 'font-size');
addConflict('font-size', 'fl-art-text');

// `<string>` widens ClassGroupIds beyond tailwind-merge's DefaultClassGroupIds so our
// dynamically-built fl-* group ids type-check as conflictingClassGroups targets.
const twMerge = extendTailwindMerge<string>({
  extend: {
    classGroups: flClassGroups,
    conflictingClassGroups: flConflicts,
  },
});

/** Tailwind-aware className combiner. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
