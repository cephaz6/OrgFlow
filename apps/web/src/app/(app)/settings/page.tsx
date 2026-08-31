import { Card, CardContent, CardHeader, CardTitle } from '@orgflow/ui';
import { ArrowLeftRight, Bell, ChevronRight, UserRound } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { HOME_CRUMB, PageHeader } from '../../../features/shell';
import { ThemeSetting } from '../../../features/theme';

export const metadata: Metadata = {
  title: 'Settings — OrgFlow',
};

export default function SettingsPage() {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        breadcrumbs={[HOME_CRUMB]}
        title="Settings"
        description="How OrgFlow looks and behaves for you."
      />

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <ThemeSetting />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col p-0">
          <Link
            href="/settings/profile"
            className="flex items-center gap-3 border-b border-divider px-6 py-4 transition-colors hover:bg-accent"
          >
            <UserRound aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium">Profile</span>
              <span className="text-sm text-muted-foreground">
                Your name, email and roles in this organisation.
              </span>
            </span>
            <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
          <Link
            href="/settings/delegations"
            className="flex items-center gap-3 border-b border-divider px-6 py-4 transition-colors hover:bg-accent"
          >
            <ArrowLeftRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium">Delegations</span>
              <span className="text-sm text-muted-foreground">
                Hand your tasks to a colleague while you are away.
              </span>
            </span>
            <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
          <Link
            href="/settings/notifications"
            className="flex items-center gap-3 px-6 py-4 transition-colors hover:bg-accent"
          >
            <Bell aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium">Notifications</span>
              <span className="text-sm text-muted-foreground">
                Which notifications reach you, and by email, in-app, or both.
              </span>
            </span>
            <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
