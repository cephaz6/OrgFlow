import type { ReactNode } from 'react';

import type { Session } from '../auth';
import { ThemeToggle } from '../theme';
import { MobileNav } from './mobile-nav';
import { OrgFlowMark } from './orgflow-logo';
import { SidebarNav } from './sidebar-nav';
import { UserMenu } from './user-menu';

export interface AppShellProps {
  session: Session;
  children: ReactNode;
}

// A fixed navigation column beside a content area, with a slim bar carrying
// only account concerns. Below the large breakpoint the column collapses
// into the dialog in mobile-nav.tsx rather than reflowing, so the same
// single navigation definition serves both.
export function AppShell({ session, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-70 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar p-4 text-sidebar-foreground lg:flex">
        <span className="flex items-center gap-2 px-1 py-1">
          <OrgFlowMark className="h-7 w-7 text-foreground" />
          <span className="text-sm font-semibold">OrgFlow</span>
        </span>
        <SidebarNav roles={session.roles} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Sticky, because the account and theme controls should not
            require scrolling back to the top of a long case timeline to
            reach. The background is opaque rather than translucent: a
            blurred bar over a scrolling table is where text-behind-text
            contrast failures come from. */}
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
          <MobileNav roles={session.roles} />

          {/* The product name, shown only where the sidebar is not: on a
              narrow viewport the shell would otherwise carry no OrgFlow
              mark at all once the column collapses. */}
          <span className="flex items-center gap-2 lg:hidden">
            <OrgFlowMark className="h-6 w-6 text-foreground" />
            <span className="text-sm font-semibold">OrgFlow</span>
          </span>

          <span className="ms-auto flex items-center gap-1.5">
            <ThemeToggle />
            <UserMenu session={session} />
          </span>
        </header>

        {/* Capped and centred rather than stretching to the viewport: a
            table or a form spanning an ultrawide monitor is unreadable,
            and every page inside this shell inherits the constraint rather
            than each one remembering to set its own. */}
        <main id="main-content" className="min-w-0 flex-1 px-4 py-8 lg:px-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
