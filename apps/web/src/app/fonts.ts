import { Bricolage_Grotesque, JetBrains_Mono, Space_Grotesk } from 'next/font/google';

// Self-hosted and subset at build time (CLAUDE.md §5.2): no runtime request
// to Google, no layout shift. Exposed as CSS variables, wired into the
// design token layer in globals.css, so no component ever names a typeface
// directly; a future GDS theme swaps these lines, nothing else.
//
// The body typeface is deliberately absent from this file. Google Sans Flex
// is not distributed under an open licence (it is in neither ofl/, apache/
// nor ufl/ in the google/fonts repository) and is not in next/font/google's
// catalogue, so it cannot be self-hosted the way these three are. It is
// loaded from Google's CDN in layout.tsx instead; ADR-0021 records that
// deviation and what it costs.

// Titles. A variable display face with a genuine optical-size axis, so a
// page heading and a card heading are not the same letterforms scaled.
export const fontDisplay = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display-app',
  display: 'swap',
});

export const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono-app',
  display: 'swap',
});

// The wordmark inside orgflow-logo.svg only, which the operator drew in
// this typeface. Kept separate from --font-display so that changing the
// heading font never silently redraws the brand mark, and loaded only on
// the pages that actually render the full lockup.
export const fontBrand = Space_Grotesk({
  subsets: ['latin'],
  weight: ['300', '600'],
  variable: '--font-brand-app',
  display: 'swap',
});
