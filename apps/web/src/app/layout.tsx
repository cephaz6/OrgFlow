import { SkipLink } from '@orgflow/ui';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { fontMono, fontSans } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'OrgFlow',
  description: 'Build and run internal workflows without writing code.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fontSans.variable} ${fontMono.variable}`}>
      {/* Browser extensions (Grammarly, password managers, dark-mode
          extensions) commonly inject attributes onto <body> before React
          hydrates. suppressHydrationWarning only silences a mismatch on
          this element's own attributes, not on any real content below it. */}
      <body suppressHydrationWarning>
        <SkipLink href="#main-content" />
        {children}
      </body>
    </html>
  );
}
