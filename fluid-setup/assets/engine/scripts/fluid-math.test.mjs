import { describe, expect, test } from 'bun:test';
import { classify, emit, emitArtText, evaluate, WIDE_FACTOR } from './fluid-math.mjs';

const approx = (x, y, eps = 0.01) => Math.abs(x - y) <= eps;

describe('anchors + user examples (root 16)', () => {
  test('pixel-exact at 360 and 1440', () => {
    for (const [a, b] of [
      [12, 16],
      [14, 16],
      [24, 40],
      [56, 120],
      [16, 24],
      [24, 24],
    ]) {
      expect(approx(evaluate(a, b, 360), a)).toBe(true);
      expect(approx(evaluate(a, b, 1440), b)).toBe(true);
    }
  });
  test('user spec: 12→16 is 14.33 @430 and 18.67 @1920, frozen @2560', () => {
    expect(approx(evaluate(12, 16, 430), 14.333)).toBe(true);
    expect(approx(evaluate(12, 16, 1920), 16 * WIDE_FACTOR)).toBe(true);
    expect(approx(evaluate(12, 16, 2560), 16 * WIDE_FACTOR)).toBe(true);
  });
  test('overshoot impossible: 14→16 never exceeds b before 1440', () => {
    for (let vw = 320; vw <= 1439; vw++) expect(evaluate(14, 16, vw)).toBeLessThanOrEqual(16.0001);
  });
  test('fixed values immobile until 1440', () => {
    for (const vw of [360, 430, 480, 768, 1024, 1439])
      expect(approx(evaluate(24, 24, vw), 24)).toBe(true);
    expect(approx(evaluate(24, 24, 1920), 28)).toBe(true);
  });
  test('glide/wide junction both convexity classes', () => {
    expect(approx(evaluate(24, 40, 768), 34.4)).toBe(true); // b<2a: max(glide,tail)
    expect(approx(evaluate(20, 56, 1000), 42.56)).toBe(true); // b>2a: min(glide,tail)
    expect(approx(evaluate(20, 56, 1700), 61.06)).toBe(true);
  });
});

describe('invariants: monotonic + continuous at roots 16/20/24', () => {
  const PAIRS = [
    [12, 16],
    [14, 16],
    [16, 16],
    [16, 24],
    [20, 28],
    [24, 40],
    [20, 56],
    [44, 60],
    [56, 120],
    [10, 40],
  ];
  for (const root of [16, 20, 24]) {
    test(`root ${root}px`, () => {
      for (const [a, b] of PAIRS) {
        let prev = -1;
        for (let vw = 320; vw <= 2560; vw += 1) {
          const v = evaluate(a, b, vw, root);
          expect(v).toBeGreaterThanOrEqual(prev - 1e-9); // monotonic
          if (prev >= 0) expect(Math.abs(v - prev)).toBeLessThan(0.35); // continuous (max slope < 0.35px/px)
          prev = v;
        }
      }
    });
  }
});

describe('emit constraints + classification', () => {
  test('classify', () => {
    expect(classify(14, 16)).toBe('increasing');
    expect(classify(24, 24)).toBe('fixed');
    expect(classify(96, 60)).toBe('inverted');
    expect(classify(1, 1, true)).toBe('flat');
  });
  test('font wide cap: 20→56 font throws (7/6·56 > 2.5·20)', () => {
    expect(() => emit(20, 56, { font: true })).toThrow(/2\.5/);
  });
  test('hero 56→120 font passes exactly (140 = 140)', () => {
    expect(() => emit(56, 120, { font: true })).not.toThrow();
  });
  test('growth cap: b > 4a throws', () => {
    expect(() => emit(10, 41)).toThrow(/4×|4x/);
  });
  test('a === 0 is a valid anchor (invisible on mobile, appears in the glide zone) — no throw, reaches b at 1440', () => {
    expect(() => emit(0, 112)).not.toThrow();
    expect(approx(evaluate(0, 112, 360), 0)).toBe(true);
    expect(approx(evaluate(0, 112, 1440), 112)).toBe(true);
    for (const root of [16, 20, 24]) {
      let prev = -1;
      for (let vw = 320; vw <= 2560; vw++) {
        const v = evaluate(0, 112, vw, root);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    }
  });
  test('a === 0 root-scaling quirk: negative glide intercept shrinks the 1440 value as root grows', () => {
    expect(approx(evaluate(0, 112, 1440, 16), 112)).toBe(true);
    expect(approx(evaluate(0, 112, 1440, 20), 98)).toBe(true);
    expect(approx(evaluate(0, 112, 1440, 24), 84)).toBe(true);
  });
  test('a === 0 font token throws — a zero mobile font is never legitimate (spacing may start at 0, fonts may not)', () => {
    expect(() => emit(0, 112, { font: true })).toThrow(/zero mobile font/);
    expect(() => emit(0, 40, { font: true })).toThrow(/zero mobile font/);
  });
  test('flat emits plain rem', () => {
    expect(emit(24, 24, { flat: true })).toBe('1.5rem');
  });
  test('inverted emits frozen single ramp', () => {
    expect(emit(96, 60)).toMatch(/^clamp\(3\.75rem, /);
  });
  test('standard emit contains no media query and is a single expression', () => {
    const css = emit(14, 16);
    expect(css.startsWith('max(0.875rem, min(3.8889vw, ')).toBe(true);
    expect(css.includes('@media')).toBe(false);
  });
});

describe('emitArtText (v2: column-relative, no viewport anchor)', () => {
  test('exact emission: 28px design text in a 311px-design copy column', () => {
    expect(emitArtText(28, 311)).toBe('9.0032cqw');
  });
  test('is a bare cqw value — no clamp(), no rem floor/ceiling', () => {
    expect(emitArtText(14, 311)).toBe('4.5016cqw');
    expect(emitArtText(14, 311).includes('clamp')).toBe(false);
  });
  test('throws unless both designPx and columnDesignPx are > 0', () => {
    expect(() => emitArtText(0, 311)).toThrow(/> 0/);
    expect(() => emitArtText(28, 0)).toThrow(/> 0/);
    expect(() => emitArtText(-28, 311)).toThrow(/> 0/);
    expect(() => emitArtText(28, -311)).toThrow(/> 0/);
  });
});

// NOTE: the reference repo also carried a `globals.css pinned expressions` suite that
// cross-checked any CSS vars pinning an emit() expression (for values JS needs to read,
// e.g. a sticky-bar height composed with env(safe-area)). It's project-specific — the
// pure inline fl-* system needs no pinned tokens — so it isn't part of this portable kit.
// If you pin any such token, add a guard asserting its value === emit(a,b) / emitMobileOnly(n).
