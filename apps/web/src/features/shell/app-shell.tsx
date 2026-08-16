import type { ReactNode } from 'react';

import { type Session, SignOutButton } from '../auth';
import { BrandMark } from './brand-mark';
import { MobileNav } from './mobile-nav';
import { SidebarNav } from './sidebar-nav';
import { UserSummary } from './user-summary';

export interface AppShellProps {
  session: Session;
  children: ReactNode;
}

// A fixed navigation column beside a wide content area, with a slim bar
// carrying only account concerns. Below the large breakpoint the column
// collapses into the dialog in mobile-nav.tsx rather than reflowing, so the
// same single navigation definition serves both.
export function AppShell({ session, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-70 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar p-4 text-sidebar-foreground lg:flex">
        <span className="flex items-center gap-2 px-1">
          <BrandMark />
          <span className="text-sm font-semibold">OrgFlow</span>
        </span>
        <SidebarNav />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-4">
          <MobileNav />
          {/* Pushes the account cluster right on large screens, where the
              menu button that would otherwise hold the left is hidden. */}
          <span className="ms-auto flex items-center gap-3">
            <UserSummary user={session.user} />
            <SignOutButton />
          </span>
        </header>

        <main id="main-content" className="min-w-0 flex-1 px-4 py-8 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
