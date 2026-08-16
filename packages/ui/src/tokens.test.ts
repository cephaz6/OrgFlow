import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  contrastRatio,
  isWithinSrgbGamut,
  parseColourTokens,
  type Oklch,
} from './test/contrast.js';

// CLAUDE.md §3 makes WCAG 2.2 AA a completion criterion, and axe-core in CI
// checks the pages that happen to exist. This checks the palette itself,
// which is where the decision actually lives: a token that fails here fails
// on every page that will ever consume it, including the ones not yet
// written. It is also the only check that can run before those pages exist.
//
// ADR-0020: there are two palettes now, dark (the bare :root default) and
// light (behind a media query and an explicit [data-theme="light"]
// attribute). Both are checked against the identical set of pairs below,
// because a token that only holds up in one theme is exactly the failure
// mode a second palette introduces.

const rawCss = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

// Comments stripped before any block extraction below: tokens.css's own
// header prose describes the selectors it uses (including the literal
// text "@media (prefers-color-scheme: light)"), and an indexOf-based
// search would otherwise find that description before the real rule and
// extract the wrong block entirely. Caught by the cross-check test at the
// bottom of this file, which is exactly the kind of drift it exists to
// catch, in this case between the test's own two extraction paths rather
// than between the file's two palettes.
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

// Extracts the declaration body of a top-level selector by brace counting,
// rather than a regex spanning to the first `}`: several of these blocks
// nest inside an @media query, and a regex would either stop at the
// @media's own opening brace or need to know how deep it is.
function extractBlock(source: string, selector: string): string {
  const start = source.indexOf(selector);
  if (start === -1) {
    throw new Error(`tokens.css has no ${selector} block.`);
  }
  const openBrace = source.indexOf('{', start);
  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBrace + 1, i);
      }
    }
  }
  throw new Error(`Unbalanced braces reading the ${selector} block.`);
}

// The bare :root block only, not the whole file: extractBlock stops at
// :root's own closing brace, before the @media and [data-theme] blocks
// that follow it in the file.
const darkDefaultCss = extractBlock(css, ':root {');
const lightMediaCss = extractBlock(css, '@media (prefers-color-scheme: light)');
const lightExplicitCss = extractBlock(css, ":root[data-theme='light']");
const darkExplicitCss = extractBlock(css, ":root[data-theme='dark']");

const darkTokens = parseColourTokens(darkDefaultCss);
const lightTokens = parseColourTokens(lightExplicitCss);

function tokenOf(tokens: Map<string, Oklch>, name: string): Oklch {
  const colour = tokens.get(name);
  if (!colour) {
    throw new Error(`This palette declares no ${name}. Update this test alongside the rename.`);
  }
  return colour;
}

// SC 1.4.3: body text and images of text.
const TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['--foreground', '--background'],
  ['--foreground', '--card'],
  ['--foreground', '--popover'],
  ['--foreground', '--muted'],
  ['--foreground', '--accent'],
  ['--foreground', '--secondary'],
  ['--sidebar-foreground', '--sidebar'],
  ['--sidebar-accent-foreground', '--sidebar-accent'],

  // The secondary text tier, which has to hold up on every surface it can
  // land on, not merely on the page background.
  ['--muted-foreground', '--background'],
  ['--muted-foreground', '--card'],
  ['--muted-foreground', '--muted'],
  ['--muted-foreground', '--sidebar'],
  ['--muted-foreground', '--sidebar-accent'],

  // Solid fills carrying their own foreground.
  ['--primary-foreground', '--primary'],
  ['--brand-foreground', '--brand'],
  ['--destructive-foreground', '--destructive'],
  ['--success-foreground', '--success'],
  ['--warning-foreground', '--warning'],

  // The subtle tier: coloured text on a dark surface, and on its own tint.
  ['--primary-subtle-foreground', '--background'],
  ['--primary-subtle-foreground', '--card'],
  ['--primary-subtle-foreground', '--primary-subtle'],
  ['--brand-subtle-foreground', '--background'],
  ['--brand-subtle-foreground', '--card'],
  ['--destructive-subtle-foreground', '--background'],
  ['--destructive-subtle-foreground', '--card'],
  ['--destructive-subtle-foreground', '--destructive-subtle'],
  ['--success-subtle-foreground', '--background'],
  ['--success-subtle-foreground', '--card'],
  ['--success-subtle-foreground', '--success-subtle'],
  ['--warning-subtle-foreground', '--background'],
  ['--warning-subtle-foreground', '--card'],
  ['--warning-subtle-foreground', '--warning-subtle'],

  ['--link', '--background'],
  ['--link', '--card'],
  ['--link', '--sidebar'],
  ['--link-hover', '--background'],
  ['--link-hover', '--card'],
];

// SC 1.4.11 and SC 2.4.11: control boundaries and focus indicators are not
// text, so 3:1 applies. --border and --divider are absent deliberately:
// they outline and separate surfaces decoratively, and nothing is
// identified by them alone.
const NON_TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['--input', '--background'],
  ['--input', '--card'],
  ['--ring', '--background'],
  ['--ring', '--card'],
  ['--ring', '--sidebar'],
  ['--primary', '--background'],
  ['--primary', '--card'],
];

describe.each([
  ['dark', darkTokens],
  ['light', lightTokens],
] as const)('%s palette', (paletteName, tokens) => {
  it('declares every colour inside the sRGB gamut', () => {
    // A token outside the gamut is clamped by the browser, so the colour
    // rendered is not the colour measured and every ratio below it becomes
    // a statement about a colour nobody sees.
    const outside = [...tokens].filter(([, colour]) => !isWithinSrgbGamut(colour)).map(([n]) => n);
    expect(outside).toEqual([]);
  });

  it.each(TEXT_PAIRS)('meets 4.5:1 for %s on %s', (foreground, background) => {
    const ratio = contrastRatio(tokenOf(tokens, foreground), tokenOf(tokens, background));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT_PAIRS)('meets 3:1 for %s on %s', (foreground, background) => {
    const ratio = contrastRatio(tokenOf(tokens, foreground), tokenOf(tokens, background));
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  it('keeps brand and primary distinguishable from one another', () => {
    // The palette's one structural claim: brand means identity and primary
    // means action, so the two must not read as the same colour. Cheap to
    // assert, and the assertion is what stops a later "tidy-up" collapsing
    // them back into one hue.
    const brand = tokenOf(tokens, '--brand');
    const primary = tokenOf(tokens, '--primary');
    const separation = Math.abs(brand.h - primary.h);
    expect(Math.min(separation, 360 - separation)).toBeGreaterThanOrEqual(30);
  });

  it('keeps the same brand and primary hue as the other palette', () => {
    // OrgFlow should read as the same product switching themes, not a
    // different one: only lightness and chroma may move between palettes,
    // never which hue "OrgFlow blue" or "OrgFlow brand" is.
    const other = paletteName === 'dark' ? lightTokens : darkTokens;
    expect(tokenOf(tokens, '--brand').h).toBeCloseTo(tokenOf(other, '--brand').h, 5);
    expect(tokenOf(tokens, '--primary').h).toBeCloseTo(tokenOf(other, '--primary').h, 5);
  });
});

describe('theme selector wiring', () => {
  it('keeps the explicit [data-theme="dark"] block identical to the bare :root default', () => {
    // Not a duplicate assertion of the dark-palette suite above: this
    // checks the *other* copy of the same values, the one an explicit
    // toggle actually applies. If a future edit updates one and not the
    // other, choosing "dark" explicitly would silently stop matching the
    // default look.
    expect(parseColourTokens(darkExplicitCss)).toEqual(darkTokens);
  });

  it('keeps the media-query light block identical to the explicit [data-theme="light"] block', () => {
    expect(parseColourTokens(lightMediaCss)).toEqual(lightTokens);
  });
});
