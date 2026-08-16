import { Inter, JetBrains_Mono, Space_Grotesk } from 'next/font/google';

// Self-hosted and subset at build time (CLAUDE.md §5.2): no runtime request
// to Google, no layout shift. Exposed as CSS variables, wired into the
// design token layer in globals.css, so no component ever names a typeface
// directly; a future GDS theme swaps these two lines, nothing else.
export const fontSans = Inter({
  subsets: ['latin'],
  variable: '--font-sans-app',
  display: 'swap',
});

export const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono-app',
  display: 'swap',
});

// The wordmark only. orgflow-logo.svg sets the OrgFlow lockup in Space
// Grotesk, and its <text> element resolves its typeface from the page like
// any other text, so without this the mark would silently fall back to
// Helvetica and the logo would render differently on different machines.
// Loaded through next/font/google for the same reason as the other two
// (CLAUDE.md §5.2): self-hosted, subset at build time, no runtime request
// and no layout shift.
export const fontDisplay = Space_Grotesk({
  subsets: ['latin'],
  weight: ['300', '600'],
  variable: '--font-display-app',
  display: 'swap',
});
