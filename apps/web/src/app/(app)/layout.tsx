import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { getSession, SignOutButton } from '../../features/auth';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold">OrgFlow</span>
          <nav aria-label="Account" className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">{session.user.displayName}</span>
            <SignOutButton />
          </nav>
        </div>
      </header>
      <main id="main-content" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        {children}
      </main>
    </div>
  );
}
