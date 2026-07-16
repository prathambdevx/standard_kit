/**
 * Validator for fl-* usages — imports the SAME math module the plugin uses,
 * so it can never disagree with emitted CSS.
 * Run: bun scripts/check-fluid.mjs [files…]   (default: glob {src,tailwind-plugins}
 * resolved from THIS script's own location via import.meta.url, so it scans the
 * right tree regardless of the caller's cwd — see the import.meta.main block.)
 *
 * Assumed layout (change the two path constants below if yours differs):
 *   <webRoot>/scripts/check-fluid.mjs          ← this file
 *   <webRoot>/tailwind-plugins/fluid.js        ← the plugin (PLUGIN_FILE)
 *   <webRoot>/src/lib/cn.ts                     ← tailwind-merge wiring (CN_FILE)
 */
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit, emitArtText } from './fluid-math.mjs';

// Files whose text is a real form <input>/<textarea>/<select> — these must never
// carry a mobile font-size below 16px (iOS Safari auto-zooms the viewport on focus
// of a sub-16px field). EDIT THIS LIST for your project: add every text-entry-control
// file. A per-LINE waiver comment `fl-input-floor-exempt: <reason>` silences the rule
// for one line (e.g. a non-input element living in the same file).
const INPUT_ATOM_FILES = [
  'src/components/ui/input.tsx',
  'src/components/ui/select.tsx',
  'src/components/ui/date_picker.tsx',
  'src/components/ui/textarea.tsx',
];

// Shared block-key extractor: given source text and a `const NAME = {` marker,
// returns the Set of top-level keys inside that object literal, or null if the
// marker can't be located (moved/renamed) — callers fail CLOSED on null instead
// of silently skipping validation. Used both for the plugin-sync cross-check
// below and for the unknown-family family set extracted at module load.
const keysOf = (src, marker) => {
  const start = src.indexOf(marker);
  if (start === -1) return null;
  const open = src.indexOf('{', start);
  const close = src.indexOf('\n};', open);
  if (open === -1 || close === -1) return null;
  return new Set(
    [...src.slice(open + 1, close).matchAll(/^\s*'?([a-zA-Z-]+)'?\s*:/gm)].map((m) => m[1]),
  );
};

// Read once at module load (not gated by import.meta.main) so checkSource can
// validate fl-<prop> families whether this module is run as the CLI or
// imported directly by tests. Fails closed to null (not a crash, not a silent
// skip) if the plugin file is missing or its PROPS marker moved — checkSource
// then reports every generic-branch match as unknown-family instead of
// trusting an unverifiable family list.
const PLUGIN_FILE = new URL('../tailwind-plugins/fluid.js', import.meta.url);
let PLUGIN_SRC = '';
try {
  PLUGIN_SRC = readFileSync(PLUGIN_FILE, 'utf8');
} catch {
  PLUGIN_SRC = '';
}
const KNOWN_FAMILIES = keysOf(PLUGIN_SRC, 'const PROPS = {');

// Two top-level alternatives, each ending directly in `-\[args\]`:
//  1. the art-text family, which has no separate "prop" segment (`fl-art-text-[..]`) —
//     must be tried BEFORE the generic branch, otherwise the generic branch's lazy prop
//     capture swallows "art-text" itself and the fam group never fires (verified: the
//     naive single-branch regex silently mis-parses these). `art-text-m` is kept in this
//     alternative too, but ONLY so it can be intercepted below with an explicit
//     removed-family message — the column-relative art-text model has no `-m` variant
//     (see fluid.js), and letting it fall through to the generic branch would report
//     a vaguer unknown-family finding instead of pointing at the actual removal.
//  2. the generic `fl-[m|d-]<prop>-[args]` shape used by every other family.
const FL_RE = /fl-(art-text-m|art-text)-\[([^\]]+)\]|fl-(?:([md])-)?([a-z-]+?)-\[([^\]]+)\]/g;

// Element-level escape hatch for `input-floor`: a file in INPUT_ATOM_FILES can still
// contain non-input elements (e.g. a Radix popover list item inside select.tsx) where
// the mobile-zoom rationale doesn't apply. Author states the reason inline — the
// waiver is per LINE (this checker is line-based), so it only silences input-floor for
// the token(s) on that exact line, never the whole file, and never other rules.
const INPUT_FLOOR_WAIVER_RE = /fl-input-floor-exempt:\s*\S/;

export function checkSource(file, text) {
  const findings = [];
  const push = (line, rule, message) => findings.push({ file, line, rule, message });
  for (const [i, lineText] of text.split('\n').entries()) {
    const hasInputFloorWaiver = INPUT_FLOOR_WAIVER_RE.test(lineText);
    for (const m of lineText.matchAll(FL_RE)) {
      const [full, artFam, artArgs, mdFam, prop, args] = m;
      if (artFam) {
        if (artFam === 'art-text-m') {
          push(
            i + 1,
            'removed-family',
            `${full}: fl-art-text-m was removed — column-relative art-text is artboard-agnostic, so a single fl-art-text-[designPx,columnDesignPx] pair covers mobile and desktop; pass the mobile comp's own column values instead`,
          );
          continue;
        }
        const axs = artArgs.split(',').map((s) => s.trim());
        if (axs.length !== 2 || axs.some((x) => !Number.isFinite(Number.parseFloat(x)))) {
          push(i + 1, 'parse', `art-text needs [designPx,columnDesignPx]: ${full}`);
          continue;
        }
        const [design, columnDesign] = axs.map(Number.parseFloat);
        try {
          emitArtText(design, columnDesign);
        } catch (e) {
          push(i + 1, 'art-text', `${full}: ${e.message}`);
        }
        continue;
      }
      if (KNOWN_FAMILIES === null) {
        push(
          i + 1,
          'unknown-family',
          `${full}: cannot verify fl-${prop} — PROPS markers moved in fluid.js; update checkSource`,
        );
        continue;
      }
      if (!KNOWN_FAMILIES.has(prop)) {
        push(
          i + 1,
          'unknown-family',
          `fl-${prop} is not a registered fluid family (see PROPS in tailwind-plugins/fluid.js): ${full}`,
        );
        continue;
      }
      const xs = args.split(',').map((s) => s.trim());
      const isFont = prop === 'text';
      const isInputAtom = INPUT_ATOM_FILES.some((f) => file.endsWith(f));
      if (mdFam) {
        const n = Number.parseFloat(xs[0]);
        if (xs.length !== 1 || !Number.isFinite(n)) {
          push(i + 1, 'parse', `single-anchor needs [n]: ${full}`);
        } else if (isFont && n < 16 && isInputAtom && !hasInputFloorWaiver) {
          push(
            i + 1,
            'input-floor',
            `${full}: inputs must be ≥16px on mobile (iOS focus auto-zoom)`,
          );
        }
        continue;
      }
      const [a, b] = xs.map(Number.parseFloat);
      const flat = xs[2] === 'flat';
      if (!Number.isFinite(a) || !Number.isFinite(b) || (xs[2] && xs[2] !== 'flat')) {
        push(i + 1, 'parse', `malformed fl value: ${full}`);
        continue;
      }
      try {
        emit(a, b, { font: isFont, flat });
      } catch (e) {
        push(
          i + 1,
          /WCAG/.test(e.message) ? 'font-wide-cap' : 'max-growth',
          `${full}: ${e.message}`,
        );
      }
      if (isFont && a < 16 && isInputAtom && !hasInputFloorWaiver)
        push(i + 1, 'input-floor', `${full}: inputs must be ≥16px on mobile (iOS focus auto-zoom)`);
    }
  }
  return findings;
}

/**
 * Cross-file invariant: every prop family the fluid tailwind plugin registers
 * (`PROPS` in tailwind-plugins/fluid.js) must have a matching entry in
 * `FL_NATIVE` (src/lib/cn.ts) or tailwind-merge will keep both the fl-* class
 * and its native equivalent instead of letting the later one win (see the
 * "KEEP IN SYNC" comment above FL_NATIVE in cn.ts).
 */
export function checkPluginSync(pluginSrc, cnSrc) {
  const findings = [];
  const push = (file, message) => findings.push({ file, line: 1, rule: 'plugin-sync', message });
  const propsKeys = keysOf(pluginSrc, 'const PROPS = {');
  const nativeKeys = keysOf(cnSrc, 'const FL_NATIVE: Record<string, string> = {');
  // Fail CLOSED: a moved/renamed marker must surface as a finding, not silently
  // disable the cross-check (the whole point is catching drift nobody notices).
  if (!propsKeys)
    push(
      'tailwind-plugins/fluid.js',
      'could not locate PROPS block — markers moved? update checkPluginSync',
    );
  if (!nativeKeys)
    push(
      'src/lib/cn.ts',
      'could not locate FL_NATIVE block — markers moved? update checkPluginSync',
    );
  if (!propsKeys || !nativeKeys) return findings;
  for (const key of propsKeys) {
    if (!nativeKeys.has(key)) {
      push(
        'tailwind-plugins/fluid.js',
        `fl-${key} has no matching FL_NATIVE entry in src/lib/cn.ts — tailwind-merge won't dedupe it`,
      );
    }
  }
  return findings;
}

if (import.meta.main) {
  // Explicit file args (the lefthook path: `check-fluid.mjs {staged_files}` run
  // from the repo root) are read as-is, relative to the caller's cwd. With no args
  // (the `bun run check:fluid` path, cwd set by the package script), the
  // glob root is resolved from THIS FILE's location — not process.cwd() — so the
  // scan is correct no matter where the script is invoked from.
  const explicitFiles = process.argv.slice(2);
  const appWebRoot = fileURLToPath(new URL('..', import.meta.url));
  const files = explicitFiles.length
    ? explicitFiles
    : globSync('{src,tailwind-plugins}/**/*.{ts,tsx,js,mjs,css}', { cwd: appWebRoot });
  if (!explicitFiles.length) {
    console.error(`[check-fluid] scanned ${files.length} files under ${appWebRoot}`);
  }
  let bad = 0;
  for (const f of files) {
    const abs = explicitFiles.length ? f : join(appWebRoot, f);
    for (const x of checkSource(f, readFileSync(abs, 'utf8'))) {
      console.error(`${x.file}:${x.line} [${x.rule}] ${x.message}`);
      bad++;
    }
  }
  // Plugin↔cn.ts cross-check. CN_FILE is the standard layout (<webRoot>/src/lib/cn.ts) —
  // edit it if your cn helper lives elsewhere. If the file is absent (e.g. the validator
  // runs before cn.ts is wired up, or the project's cn lives somewhere unset), warn and
  // skip rather than crash — a missing cn is a setup state, not a fl-* usage violation.
  const cnFile = new URL('../src/lib/cn.ts', import.meta.url);
  let cnSrc = null;
  try {
    cnSrc = readFileSync(cnFile, 'utf8');
  } catch {
    console.error(
      `[check-fluid] skipped plugin↔cn.ts sync check — no cn.ts at ${fileURLToPath(cnFile)} (edit CN_FILE if yours is elsewhere)`,
    );
  }
  for (const x of cnSrc ? checkPluginSync(PLUGIN_SRC, cnSrc) : []) {
    console.error(`${x.file}:${x.line} [${x.rule}] ${x.message}`);
    bad++;
  }
  process.exit(bad ? 1 : 0);
}
