import { Card, CardContent, EmptyState } from '@orgflow/ui';
import { ShieldOff } from 'lucide-react';
import type { Metadata } from 'next';

import { InviteForm } from '../../../../../features/invitations';
import { fetchMembers } from '../../../../../features/members';
import { PageHeader, SectionTabs } from '../../../../../features/shell';

export const metadata: Metadata = {
  title: 'Invite a member: OrgFlow',
};

// The three tabs, defined once here rather than shared through a barrel:
// features/members' own barrel also re-exports a Server Component-only
// fetch (it reads next/headers), and SectionTabs is a Client Component, so
// pulling the item list through that barrel would bundle the server-only
// code into the client the same way it did for the invite form's role
// checkboxes. Three lines, duplicated identically on the other two pages,
// is the cheaper trade.
const TABS = [
  { href: '/settings/members/invite', label: 'Invite a member' },
  { href: '/settings/members/invitations', label: 'Invitations' },
  { href: '/settings/members/directory', label: 'Active members' },
];

// Reachable directly by URL, not only through the /settings/members
// overview, so it carries its own admin gate rather than trusting that the
// visitor arrived by clicking through a page that already checked.
export default async function InviteMemberPage() {
  const members = await fetchMembers();

  if (members === null) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Invite a member" />
        <EmptyState
          icon={ShieldOff}
          title="Admin access required"
          description="Inviting members needs the admin or owner role. Ask an administrator to grant it if you need to see this."
        />
      </div>
    );
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <SectionTabs label="Members sections" items={TABS} />

      <PageHeader
        title="Invite a member"
        description="They will receive a link to join, and can be assigned roles now or later."
      />

      <Card>
        {/* pt-6 rather than plain CardContent: CardContent's own p-6 pt-0
            assumes a CardHeader sits above it to supply the top padding.
            There is no header here (PageHeader already carries the title),
            so the unmodified pt-0 left the form flush against the card's
            top border. */}
        <CardContent className="pt-6">
          <InviteForm />
        </CardContent>
      </Card>
    </div>
  );
}
