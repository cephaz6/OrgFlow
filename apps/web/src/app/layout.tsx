import { SkipLink } from '@orgflow/ui';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { ThemeProvider, ThemeScript } from '../features/theme';
import { fontBrand, fontDisplay, fontMono } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'OrgFlow',
  description: 'Build and run internal workflows without writing code.',
};

// Google Sans Flex is served by Google's CDN but is not open-licensed and is
// not in next/font/google's catalogue, so unlike every other typeface here it
// cannot be self-hosted (ADR-0021). preconnect to both hosts because the
// stylesheet and the font files it references live on different origins, and
// the browser cannot discover the second until it has parsed the first;
// without this the font arrives a full round trip later than it needs to.
const GOOGLE_SANS_FLEX_HREF =
  'https://fonts.googleapis.com/css2?family=Google+Sans+Flex:opsz,wght@6..144,1..1000&display=swap';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning here too, not only on <body>: ThemeScript
    // sets data-theme on this element before React hydrates, which is
    // exactly the kind of pre-hydration attribute mutation the warning
    // exists to catch and exactly the one case where it is expected.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fontDisplay.variable} ${fontMono.variable} ${fontBrand.variable}`}
    >
      <head>
        <ThemeScript />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        {/* crossOrigin is required on this one and not the other: font files
            are fetched in CORS mode, and a preconnect whose mode does not
            match the later request opens a second, useless connection. */}
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={GOOGLE_SANS_FLEX_HREF} />
      </head>
      {/* Browser extensions (Grammarly, password managers, dark-mode
          extensions) commonly inject attributes onto <body> before React
          hydrates. suppressHydrationWarning only silences a mismatch on
          this element's own attributes, not on any real content below it. */}
      <body suppressHydrationWarning>
        <ThemeProvider>
          <SkipLink href="#main-content" />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
