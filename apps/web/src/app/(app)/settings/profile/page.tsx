import { Card, CardContent, CardHeader, CardTitle } from '@orgflow/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getSession } from '../../../../features/auth';
import { PageHeader } from '../../../../features/shell';

export const metadata: Metadata = {
  title: 'Profile — OrgFlow',
};

const ROLE_LABELS: Record<string, string> = {
  member: 'Member',
  approver: 'Approver',
  processOwner: 'Process owner',
  admin: 'Administrator',
  owner: 'Owner',
};

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const { user, roles } = session;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Profile"
        description="Who you are signed in as, and what you can do in this organisation."
      />

      <Card>
        <CardHeader>
          <CardTitle>Your details</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Read-only, and honestly so. Name and email come from the
              identity provider (ADR-0002), not from OrgFlow, so editing
              them here would either silently do nothing or be overwritten
              at the next sign-in. */}
          <dl className="flex flex-col">
            <div className="flex flex-col gap-1 border-b border-divider py-3 first:pt-0 last:border-b-0 sm:flex-row sm:gap-4">
              <dt className="text-sm text-muted-foreground sm:w-56 sm:shrink-0">Name</dt>
              <dd className="text-sm">{user.displayName}</dd>
            </div>
            <div className="flex flex-col gap-1 border-b border-divider py-3 last:border-b-0 sm:flex-row sm:gap-4">
              <dt className="text-sm text-muted-foreground sm:w-56 sm:shrink-0">Email</dt>
              <dd className="text-sm">{user.email}</dd>
            </div>
            <div className="flex flex-col gap-1 border-b border-divider py-3 last:border-b-0 sm:flex-row sm:gap-4">
              <dt className="text-sm text-muted-foreground sm:w-56 sm:shrink-0">
                Roles in this organisation
              </dt>
              <dd className="text-sm">
                {roles.length > 0
                  ? roles.map((role) => ROLE_LABELS[role] ?? role).join(', ')
                  : 'No roles assigned'}
              </dd>
            </div>
          </dl>

          <p className="pt-4 text-sm text-muted-foreground">
            Your name and email come from your organisation&apos;s identity provider, so they are
            changed there rather than here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
