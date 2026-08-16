import { SkipLink } from '@orgflow/ui';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { ThemeProvider, ThemeScript } from '../features/theme';
import { fontDisplay, fontMono, fontSans } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'OrgFlow',
  description: 'Build and run internal workflows without writing code.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning here too, not only on <body>: ThemeScript
    // sets data-theme on this element before React hydrates, which is
    // exactly the kind of pre-hydration attribute mutation the warning
    // exists to catch and exactly the one case where it is expected.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fontSans.variable} ${fontMono.variable} ${fontDisplay.variable}`}
    >
      <head>
        <ThemeScript />
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
