import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkPluginSync, checkSource } from './check-fluid.mjs';

describe('check-fluid rules', () => {
  test('finds fl-* tokens anywhere in text (template literals included)', () => {
    const findings = checkSource('x.tsx', 'const c = `fl-text-[20,56] ${y}`;');
    expect(findings.some((f) => f.rule === 'font-wide-cap')).toBe(true);
  });
  test('max-growth', () => {
    expect(checkSource('x.tsx', "cn('fl-w-[10,41]')")[0].rule).toBe('max-growth');
  });
  test('input-floor fires only in input-atom files', () => {
    const bad = checkSource('src/components/ui/input.tsx', "'fl-text-[14,16]'");
    expect(bad[0].rule).toBe('input-floor');
    expect(checkSource('src/modules/pdp/view.tsx', "'fl-text-[14,16]'")).toEqual([]);
  });
  test('input-floor also fires for single-anchor fl-m-text/fl-d-text in input atoms', () => {
    const m = checkSource('src/components/ui/input.tsx', "'fl-m-text-[14]'");
    expect(m[0].rule).toBe('input-floor');
    const d = checkSource('src/components/ui/select.tsx', "'fl-d-text-[12]'");
    expect(d[0].rule).toBe('input-floor');
    // ≥16 is fine, and non-atom files stay exempt
    expect(checkSource('src/components/ui/input.tsx', "'fl-m-text-[16]'")).toEqual([]);
    expect(checkSource('src/modules/pdp/view.tsx', "'fl-m-text-[14]'")).toEqual([]);
  });
  test('clean source yields no findings', () => {
    expect(checkSource('x.tsx', "cn('fl-p-[16,24] fl-text-[16,20]')")).toEqual([]);
  });
  test('input-floor fires for a raw input atom below 16px', () => {
    const bad = checkSource('src/components/ui/input.tsx', "'fl-text-[12,14]'");
    expect(bad[0].rule).toBe('input-floor');
    expect(checkSource('src/components/ui/input.tsx', "'fl-text-[16,16]'")).toEqual([]);
  });

  // art-text has no separate "prop" segment before its bracket (`fl-art-text-[..]`) —
  // a naive single-branch regex swallows "art-text" into the prop capture instead of
  // the family capture, so a valid 2-arg art-text token gets misread as a malformed
  // 2-value token (which would coincidentally not error, hiding the parse bug). Guard the fix.
  test('fl-art-text-[designPx,columnDesignPx] parses as art-text, not the generic 2-value branch', () => {
    expect(checkSource('x.tsx', "cn('fl-art-text-[28,311]')")).toEqual([]);
  });
  test('fl-art-text-m-[..] is a removed family (v2 is artboard-agnostic — no mobile variant)', () => {
    const findings = checkSource('x.tsx', "cn('fl-art-text-m-[28,311]')");
    expect(findings[0].rule).toBe('removed-family');
  });
  test('fl-art-text-[..] with wrong arity still reports parse', () => {
    expect(checkSource('x.tsx', "cn('fl-art-text-[28]')")[0].rule).toBe('parse');
    expect(checkSource('x.tsx', "cn('fl-art-text-[28,311,10]')")[0].rule).toBe('parse');
  });
});

describe('check-fluid input-floor element-level waiver', () => {
  test('marker with a reason suppresses input-floor for a sub-16 fl-text on that line', () => {
    const findings = checkSource(
      'src/components/ui/select.tsx',
      "'fl-text-[14,16]' // fl-input-floor-exempt: popover list item, not a text-entry control",
    );
    expect(findings).toEqual([]);
  });
  test('without the marker, the same sub-16 fl-text still fires input-floor (existing behavior)', () => {
    const findings = checkSource('src/components/ui/select.tsx', "'fl-text-[14,16]'");
    expect(findings[0].rule).toBe('input-floor');
  });
  test('the marker does not suppress a font-wide-cap violation on the same line', () => {
    const findings = checkSource(
      'src/components/ui/select.tsx',
      "'fl-text-[8,20]' // fl-input-floor-exempt: popover list item, not a text-entry control",
    );
    expect(findings.some((f) => f.rule === 'font-wide-cap')).toBe(true);
    expect(findings.some((f) => f.rule === 'input-floor')).toBe(false);
  });
});

describe('check-fluid unknown-family rule', () => {
  test('flags a misspelled family (fl-txt instead of fl-text)', () => {
    const findings = checkSource('x.tsx', "cn('fl-txt-[14,16]')");
    expect(findings.some((f) => f.rule === 'unknown-family')).toBe(true);
  });
  test('flags a misspelled family (fl-pad instead of fl-p)', () => {
    const findings = checkSource('x.tsx', "cn('fl-pad-[16,24]')");
    expect(findings.some((f) => f.rule === 'unknown-family')).toBe(true);
  });
  test('flags a misspelled single-anchor family (fl-m-txt)', () => {
    const findings = checkSource('x.tsx', "cn('fl-m-txt-[14]')");
    expect(findings.some((f) => f.rule === 'unknown-family')).toBe(true);
  });
  test('fl-min-h is a real (hyphenated) family and stays clean', () => {
    expect(checkSource('x.tsx', "cn('fl-min-h-[40,60]')")).toEqual([]);
  });
  test('every real PROPS family is accepted (no unknown-family finding)', () => {
    const families = [
      'text',
      'leading',
      'gap',
      'w',
      'h',
      'min-h',
      'max-w',
      'basis',
      'p',
      'px',
      'py',
      'pt',
      'pb',
      'pl',
      'pr',
      'm',
      'mx',
      'my',
      'mt',
      'mb',
      'bottom',
      'left',
      'right',
      'size',
    ];
    for (const fam of families) {
      expect(checkSource('x.tsx', `cn('fl-${fam}-[16,24]')`)).toEqual([]);
    }
  });
});

describe('check-fluid art-text semantics', () => {
  test('flags columnDesignPx = 0 (plugin throws in emitArtText)', () => {
    const findings = checkSource('x.tsx', "cn('fl-art-text-[28,0]')");
    expect(findings.some((f) => f.rule === 'art-text')).toBe(true);
  });
  test('flags designPx = 0 (plugin throws in emitArtText)', () => {
    const findings = checkSource('x.tsx', "cn('fl-art-text-[0,311]')");
    expect(findings.some((f) => f.rule === 'art-text')).toBe(true);
  });
  test('valid art-text (designPx,columnDesignPx both > 0) stays clean', () => {
    expect(checkSource('x.tsx', "cn('fl-art-text-[28,311]')")).toEqual([]);
  });
});

describe('check-fluid CLI glob-mode root resolution', () => {
  // Regression guard: `bun run check:fluid` runs this script with no file args,
  // from whatever cwd the package script sets. The default glob must resolve its
  // scan root from the script's own location (import.meta.url), not process.cwd(),
  // or from the wrong cwd it would match nothing and the CLI would silently exit 0
  // having scanned zero files. It also prints a scanned-count line so the no-op can
  // never hide again. Spawn the real CLI (not just checkSource) — this path lives
  // entirely in the import.meta.main block, which unit tests of checkSource
  // can't exercise.
  test('resolves the glob root from the script location (not cwd) and reports a count', () => {
    const webRoot = fileURLToPath(new URL('..', import.meta.url));
    const result = spawnSync('bun', ['scripts/check-fluid.mjs'], {
      cwd: webRoot,
      encoding: 'utf8',
    });
    const match = /scanned (\d+) files/.exec(result.stderr ?? '');
    expect(match).not.toBeNull();
    // > 0 proves the glob resolved against the script's own tree; the exact count
    // is project-size-dependent (this kit's engine dir has just the plugin file).
    expect(Number(match[1])).toBeGreaterThan(0);
  });
});

describe('check-fluid plugin-sync', () => {
  test('flags a PROPS key with no FL_NATIVE entry', () => {
    const plugin =
      'const PROPS = {\n  text: (v) => ({ fontSize: v }),\n  foo: (v) => ({ foo: v }),\n};';
    const cn = "const FL_NATIVE: Record<string, string> = {\n  text: 'font-size',\n};";
    const findings = checkPluginSync(plugin, cn);
    expect(findings.some((f) => f.rule === 'plugin-sync' && f.message.includes('fl-foo'))).toBe(
      true,
    );
  });
  test('passes when PROPS is a subset of FL_NATIVE', () => {
    const plugin = 'const PROPS = {\n  text: (v) => ({ fontSize: v }),\n};';
    const cn =
      "const FL_NATIVE: Record<string, string> = {\n  text: 'font-size',\n  gap: 'gap',\n};";
    expect(checkPluginSync(plugin, cn)).toEqual([]);
  });
  test('fails closed when a marker block cannot be located', () => {
    const findings = checkPluginSync('nothing here', 'nothing here either');
    expect(findings.some((f) => f.rule === 'plugin-sync' && /markers moved/.test(f.message))).toBe(
      true,
    );
  });
  test('findings use 1-indexed line numbers', () => {
    const plugin = 'const PROPS = {\n  foo: (v) => ({ foo: v }),\n};';
    const cn = "const FL_NATIVE: Record<string, string> = {\n  text: 'font-size',\n};";
    for (const f of checkPluginSync(plugin, cn)) {
      expect(f.line).toBeGreaterThanOrEqual(1);
    }
  });
});
