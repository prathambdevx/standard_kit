/**
 * Static scan for the recurring iOS Safari bug patterns documented in
 * ../SKILL.md. Line-based, regex-driven — a linter, not a browser; it flags
 * likely offenders for a human/model to confirm and fix, the same way
 * check-fluid.mjs (in the fluid-setup kit) flags fl-* violations.
 *
 * Run: bun scripts/check-ios-safari.mjs [files…]   (default: glob src/**\/*.tsx)
 */
import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// --- Rule 1: SVG width/height + w-auto/h-auto -------------------------------
// iOS Safari ignores an auto-width/height Tailwind class on an <svg> that
// also carries a hardcoded width/height ATTRIBUTE — it keeps the attribute's
// literal pixel value instead of recomputing from the CSS box, cropping the
// icon whenever a parent forces a different size. Flag the combination so it
// gets an explicit width/height class instead of `w-auto`/`h-auto`.
const SVG_TAG_RE = /<svg\b[^>]*>/g;
const HAS_WIDTH_ATTR_RE = /\bwidth=["']?\d/;
const HAS_HEIGHT_ATTR_RE = /\bheight=["']?\d/;
const HAS_W_AUTO_RE = /\bw-auto\b/;
const HAS_H_AUTO_RE = /\bh-auto\b/;

// --- Rule 2: sub-16px text on a text-entry control --------------------------
// A focused <input>/<textarea>/<select> rendering below 16px triggers iOS
// Safari's auto-zoom (it zooms the whole viewport in to make the text
// legible, then the user has to manually zoom back out — feels broken).
// This complements (doesn't replace) the fluid-setup kit's fl-input-floor
// rule: that one only catches fl-text-[a,...] tokens on files it's told
// about; this one catches ANY raw text-[Npx] / text-sm / text-xs on an
// input/textarea/select element, fluid or not.
const INPUT_TAG_RE = /<(input|textarea|select)\b[^>]*>/g;
const SUB16_TEXT_RE = /\btext-\[(\d+)px\]/;
const SMALL_TEXT_CLASS_RE = /\btext-(xs|sm)\b/;
// A responsive override (`lg:text-[16px]`, `md:text-base`, etc.) means the
// BASE size is mobile-only — still worth flagging, since mobile is exactly
// where the zoom bug bites. We don't suppress on a responsive prefix existing;
// we only suppress when the base itself is already ≥16px.

// --- Rule 3: dvh/vh in a full-viewport-lock context -------------------------
// `dvh` tracks the LIVE viewport, which changes as iOS Safari's URL bar
// hides/shows on scroll — anything sized with dvh visibly resizes/jumps
// mid-interaction (a fullscreen lightbox, a hero locked to one screen, a
// modal capped at "the viewport"). `svh` (smallest viewport height) is stable
// through the whole URL-bar animation. This rule is a nudge, not a hard
// error — dvh has legitimate uses (e.g. deliberately tracking the live
// viewport) — so it reports at 'info' severity for a human to confirm.
const DVH_RE = /\b\d+dvh\b/g;

// --- Rule 4: safe-area-inset-bottom appearing more than once in a file ------
// A nested ancestor + descendant each adding `env(safe-area-inset-bottom)`
// stacks the inset twice, over-padding bottom-fixed bars on notched iPhones.
// Heuristic only (can't trace the DOM nesting statically) — surfaces as a
// review nudge when the same file applies it 2+ times.
const SAFE_AREA_BOTTOM_RE = /env\(safe-area-inset-bottom\)/g;

export function checkSource(file, text) {
  const findings = [];
  const push = (line, rule, severity, message) =>
    findings.push({ file, line, rule, severity, message });
  const lines = text.split('\n');

  for (const [i, lineText] of lines.entries()) {
    for (const m of lineText.matchAll(SVG_TAG_RE)) {
      const tag = m[0];
      if (
        (HAS_WIDTH_ATTR_RE.test(tag) && HAS_W_AUTO_RE.test(tag)) ||
        (HAS_HEIGHT_ATTR_RE.test(tag) && HAS_H_AUTO_RE.test(tag))
      ) {
        push(
          i + 1,
          'svg-auto-size',
          'error',
          'iOS Safari ignores w-auto/h-auto on an <svg> with a hardcoded width/height attribute — it keeps the attribute\'s literal px value and crops the icon. Give it an explicit width/height class matching the true viewBox aspect ratio instead.',
        );
      }
    }

    for (const m of lineText.matchAll(INPUT_TAG_RE)) {
      const tag = m[0];
      const sub16 = SUB16_TEXT_RE.exec(tag);
      if (sub16 && Number(sub16[1]) < 16) {
        push(
          i + 1,
          'input-zoom',
          'error',
          `${sub16[0]} on a text-entry control is below 16px — iOS Safari auto-zooms the viewport on focus. Use 16px (or larger) at the base/mobile breakpoint.`,
        );
      } else if (SMALL_TEXT_CLASS_RE.test(tag)) {
        push(
          i + 1,
          'input-zoom',
          'error',
          `${SMALL_TEXT_CLASS_RE.exec(tag)[0]} on a text-entry control renders below 16px in the default Tailwind scale — iOS Safari auto-zooms the viewport on focus. Use text-base (16px) or larger at the base/mobile breakpoint.`,
        );
      }
    }

    for (const _m of lineText.matchAll(DVH_RE)) {
      push(
        i + 1,
        'dvh-usage',
        'info',
        'dvh tracks the live viewport and resizes as the iOS URL bar hides/shows. If this element must never resize mid-interaction (fullscreen overlay, locked hero, lightbox), use svh instead. If it deliberately tracks the live viewport, this is fine — confirm and move on.',
      );
    }
  }

  const safeAreaCount = (text.match(SAFE_AREA_BOTTOM_RE) ?? []).length;
  if (safeAreaCount > 1) {
    push(
      1,
      'safe-area-double-stack',
      'warn',
      `env(safe-area-inset-bottom) appears ${safeAreaCount} times in this file — if any of these elements are nested (a wrapper AND a child both padding for the inset), the inset stacks and over-pads bottom-fixed content on notched iPhones. Confirm only one ancestor in each chain applies it.`,
    );
  }

  return findings;
}

if (import.meta.main) {
  const explicitFiles = process.argv.slice(2);
  const srcRoot = fileURLToPath(new URL('..', import.meta.url));
  const files = explicitFiles.length
    ? explicitFiles
    : globSync('src/**/*.{tsx,jsx}', { cwd: srcRoot }).map((f) => `${srcRoot}${f}`);

  let bad = 0;
  let info = 0;
  for (const f of files) {
    let text;
    try {
      text = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    for (const x of checkSource(f, text)) {
      console.error(`${x.file}:${x.line} [${x.severity}/${x.rule}] ${x.message}`);
      if (x.severity === 'info') info++;
      else bad++;
    }
  }
  if (bad || info) {
    console.error(`\n[check-ios-safari] ${bad} error/warn finding(s), ${info} info finding(s)`);
  }
  // Only error/warn findings fail the gate — 'info' (dvh usage) is a nudge, not a block.
  process.exit(bad ? 1 : 0);
}
