import { EmptyState } from '@orgflow/ui';
import { ShieldOff } from 'lucide-react';
import type { Metadata } from 'next';

import { fetchInvitations, PendingInvitationsList } from '../../../../../features/invitations';
import { PageHeader, SectionTabs } from '../../../../../features/shell';

export const metadata: Metadata = {
  title: 'Invitations: OrgFlow',
};

const TABS = [
  { href: '/settings/members/invite', label: 'Invite a member' },
  { href: '/settings/members/invitations', label: 'Invitations' },
  { href: '/settings/members/directory', label: 'Active members' },
];

export default async function InvitationsPage() {
  const invitations = await fetchInvitations();

  if (invitations === null) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Invitations" />
        <EmptyState
          icon={ShieldOff}
          title="Admin access required"
          description="Managing invitations needs the admin or owner role. Ask an administrator to grant it if you need to see this."
        />
      </div>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <SectionTabs label="Members sections" items={TABS} />

      <PageHeader
        title="Invitations"
        description="Every invitation sent from this organisation, and its current status."
      />

      {/* Not wrapped in a Card: the list already renders its own bordered
          surface (matching how MemberList is used unwrapped on the
          directory page), and a Card around it produced a border nested
          inside a border rather than one clean edge. */}
      <PendingInvitationsList invitations={invitations} />
    </div>
  );
}
