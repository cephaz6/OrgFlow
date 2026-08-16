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
// The reference design this palette follows (see the recorded design
// direction) leans on muted grey against near-black, which frequently
// fails 4.5:1. That look is kept; the exact greys are not.

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const tokens = parseColourTokens(css);

function tokenOf(name: string): Oklch {
  const colour = tokens.get(name);
  if (!colour) {
    throw new Error(`tokens.css declares no ${name}. Update this test alongside the rename.`);
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

describe('design tokens', () => {
  it('declares every colour inside the sRGB gamut', () => {
    // A token outside the gamut is clamped by the browser, so the colour
    // rendered is not the colour measured and every ratio below it becomes
    // a statement about a colour nobody sees.
    const outside = [...tokens].filter(([, colour]) => !isWithinSrgbGamut(colour)).map(([n]) => n);
    expect(outside).toEqual([]);
  });

  it.each(TEXT_PAIRS)('meets 4.5:1 for %s on %s', (foreground, background) => {
    const ratio = contrastRatio(tokenOf(foreground), tokenOf(background));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT_PAIRS)('meets 3:1 for %s on %s', (foreground, background) => {
    const ratio = contrastRatio(tokenOf(foreground), tokenOf(background));
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  it('keeps brand and primary distinguishable from one another', () => {
    // The palette's one structural claim: brand means identity and primary
    // means action, so the two must not read as the same colour. Cheap to
    // assert, and the assertion is what stops a later "tidy-up" collapsing
    // them back into one hue.
    const brand = tokenOf('--brand');
    const primary = tokenOf('--primary');
    const separation = Math.abs(brand.h - primary.h);
    expect(Math.min(separation, 360 - separation)).toBeGreaterThanOrEqual(30);
  });
});
