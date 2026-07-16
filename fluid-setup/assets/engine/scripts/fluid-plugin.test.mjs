import { describe, expect, test } from 'bun:test';
import plugin from '../tailwind-plugins/fluid.js';
import { emit, emitArtText } from './fluid-math.mjs';

// Capture the utilities the plugin registers by faking the Tailwind API.
const utilities = {};
plugin.handler({ matchUtilities: (u) => Object.assign(utilities, u) });

describe('fl-* plugin', () => {
  test('registers all families', () => {
    for (const k of ['fl-text', 'fl-p', 'fl-size', 'fl-m-h', 'fl-d-w', 'fl-art-text'])
      expect(typeof utilities[k]).toBe('function');
  });
  test('registers gap-x/gap-y/ml/mr families', () => {
    for (const k of ['fl-gap-x', 'fl-gap-y', 'fl-ml', 'fl-mr'])
      expect(typeof utilities[k]).toBe('function');
  });
  test('fl-gap-x/fl-gap-y map to column/row gap independently', () => {
    expect(utilities['fl-gap-x']('8,12')).toEqual({ columnGap: emit(8, 12) });
    expect(utilities['fl-gap-y']('8,12')).toEqual({ rowGap: emit(8, 12) });
  });
  test('fl-ml/fl-mr map to one margin side only', () => {
    expect(utilities['fl-ml']('16,24')).toEqual({ marginLeft: emit(16, 24) });
    expect(utilities['fl-mr']('16,24')).toEqual({ marginRight: emit(16, 24) });
  });
  test('fl-art-text-m is deleted — column-relative v2 is artboard-agnostic', () => {
    expect(utilities['fl-art-text-m']).toBeUndefined();
  });
  test('fl-text-[14,16] emits the math module expression as font-size', () => {
    expect(utilities['fl-text']('14,16')).toEqual({ fontSize: emit(14, 16, { font: true }) });
  });
  test('fl-px maps to both padding sides', () => {
    const css = utilities['fl-px']('16,24');
    expect(css.paddingLeft).toBe(emit(16, 24));
    expect(css.paddingLeft).toBe(css.paddingRight);
  });
  test('flat modifier pins the value', () => {
    expect(utilities['fl-p']('24,24,flat')).toEqual({ padding: '1.5rem' });
  });
  test('font constraint violations surface as build errors (throw)', () => {
    expect(() => utilities['fl-text']('20,56')).toThrow(/WCAG/);
  });
  test('art text emits px fallback THEN cqw value (order matters for old browsers)', () => {
    const css = utilities['fl-art-text']('28,311');
    expect(css['font-size']).toEqual(['28px', emitArtText(28, 311)]);
  });
  test('malformed values emit nothing rather than garbage', () => {
    expect(utilities['fl-text']('abc')).toEqual({});
    expect(utilities['fl-p']('12')).toEqual({});
  });
});
