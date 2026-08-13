import { Inter, JetBrains_Mono } from 'next/font/google';

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
