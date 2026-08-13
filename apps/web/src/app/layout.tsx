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
      <body>
        <SkipLink href="#main-content" />
        {children}
      </body>
    </html>
  );
}
