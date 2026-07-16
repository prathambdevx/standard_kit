import { describe, expect, test } from 'bun:test';
import { checkSource } from './check-ios-safari.mjs';

describe('svg-auto-size', () => {
  test('flags w-auto paired with a hardcoded width attribute', () => {
    const findings = checkSource(
      'x.tsx',
      '<svg width="179" height="22" viewBox="0 0 179 22" className="w-auto h-[16px]" />',
    );
    expect(findings.some((f) => f.rule === 'svg-auto-size')).toBe(true);
  });
  test('flags h-auto paired with a hardcoded height attribute', () => {
    const findings = checkSource(
      'x.tsx',
      '<svg width="20" height="18" className="w-[20px] h-auto" />',
    );
    expect(findings.some((f) => f.rule === 'svg-auto-size')).toBe(true);
  });
  test('does not flag an svg with explicit width AND height classes', () => {
    const findings = checkSource(
      'x.tsx',
      '<svg width="20" height="18" className="w-[20px] h-[18px]" />',
    );
    expect(findings).toEqual([]);
  });
  test('does not flag w-auto on an svg with no hardcoded width attribute', () => {
    const findings = checkSource('x.tsx', '<svg viewBox="0 0 20 18" className="w-auto" />');
    expect(findings).toEqual([]);
  });
});

describe('input-zoom', () => {
  test('flags an explicit sub-16px text size on <input>', () => {
    const findings = checkSource('x.tsx', '<input className="text-[14px] lg:text-[16px]" />');
    expect(findings.some((f) => f.rule === 'input-zoom')).toBe(true);
  });
  test('flags text-sm on <textarea>', () => {
    const findings = checkSource('x.tsx', '<textarea className="text-sm" />');
    expect(findings.some((f) => f.rule === 'input-zoom')).toBe(true);
  });
  test('flags text-xs on <select>', () => {
    const findings = checkSource('x.tsx', '<select className="text-xs" />');
    expect(findings.some((f) => f.rule === 'input-zoom')).toBe(true);
  });
  test('does not flag 16px or larger on an input', () => {
    const findings = checkSource('x.tsx', '<input className="text-[16px]" />');
    expect(findings).toEqual([]);
  });
  test('does not flag sub-16px text on a non-input element', () => {
    const findings = checkSource('x.tsx', '<p className="text-[12px]" />');
    expect(findings).toEqual([]);
  });
});

describe('dvh-usage', () => {
  test('reports dvh usage as an info-level nudge, not an error', () => {
    const findings = checkSource('x.tsx', 'style={{ maxHeight: "calc(100dvh - 150px)" }}');
    const f = findings.find((x) => x.rule === 'dvh-usage');
    expect(f).toBeDefined();
    expect(f.severity).toBe('info');
  });
  test('does not flag svh', () => {
    const findings = checkSource('x.tsx', 'style={{ maxHeight: "calc(100svh - 150px)" }}');
    expect(findings.some((f) => f.rule === 'dvh-usage')).toBe(false);
  });
});

describe('safe-area-double-stack', () => {
  test('warns when the same file applies safe-area-inset-bottom more than once', () => {
    const src = [
      '<div className="pb-[env(safe-area-inset-bottom)]">',
      '  <div className="pb-[calc(32px+env(safe-area-inset-bottom))]" />',
      '</div>',
    ].join('\n');
    const findings = checkSource('x.tsx', src);
    expect(findings.some((f) => f.rule === 'safe-area-double-stack')).toBe(true);
  });
  test('does not warn on a single usage', () => {
    const findings = checkSource('x.tsx', '<div className="pb-[env(safe-area-inset-bottom)]" />');
    expect(findings.some((f) => f.rule === 'safe-area-double-stack')).toBe(false);
  });
});

describe('clean source', () => {
  test('a fully-fixed file produces zero findings', () => {
    const src = [
      '<svg width="20" height="18" className="w-[20px] h-[18px]" />',
      '<input className="text-[16px]" />',
      '<div style={{ maxHeight: "calc(100svh - 150px)" }} />',
      '<div className="pb-[env(safe-area-inset-bottom)]" />',
    ].join('\n');
    expect(checkSource('x.tsx', src)).toEqual([]);
  });
});
