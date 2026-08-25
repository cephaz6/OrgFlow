import { Card, CardContent, EmptyState } from '@orgflow/ui';
import { ChevronRight, Mail, ShieldOff, UserPlus, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { fetchInvitations } from '../../../../features/invitations';
import { fetchMembers } from '../../../../features/members';
import { PageHeader } from '../../../../features/shell';

export const metadata: Metadata = {
  title: 'Members: OrgFlow',
};

// Three destinations rather than one page carrying all of it inline: invite,
// invitations and the directory used to be three sections stacked on top of
// each other, which read as one long, busy screen and buried the directory
// (the thing most visits are actually for) below a form and a table most
// visits do not need. Same row-link pattern /settings itself already uses.
export default async function MembersPage() {
  const [members, invitations] = await Promise.all([fetchMembers(), fetchInvitations()]);

  if (members === null) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Members" />
        <EmptyState
          icon={ShieldOff}
          title="Admin access required"
          description="Managing members needs the admin or owner role. Ask an administrator to grant it if you need to see this."
        />
      </div>
    );
  }

  const pendingCount = (invitations ?? []).filter(
    (invitation) => !invitation.acceptedAt && !invitation.revokedAt,
  ).length;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Members"
        description="Everyone in this organisation, the roles they hold, and who they report to."
      />

      <Card>
        <CardContent className="flex flex-col p-0">
          <SectionLink
            href="/settings/members/invite"
            icon={UserPlus}
            title="Invite a member"
            description="Send an invitation by email."
          />
          <SectionLink
            href="/settings/members/invitations"
            icon={Mail}
            title="Invitations"
            description={
              pendingCount === 0
                ? 'None pending right now.'
                : `${pendingCount} pending invitation${pendingCount === 1 ? '' : 's'}.`
            }
          />
          <SectionLink
            href="/settings/members/directory"
            icon={Users}
            title="Active members"
            description={`${members.length} member${members.length === 1 ? '' : 's'} in this organisation.`}
            last
          />
        </CardContent>
      </Card>
    </div>
  );
}

interface SectionLinkProps {
  href: string;
  icon: typeof UserPlus;
  title: string;
  description: string;
  last?: boolean;
}

function SectionLink({ href, icon: Icon, title, description, last }: SectionLinkProps) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-6 py-4 transition-colors hover:bg-accent ${last ? '' : 'border-b border-divider'}`}
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-sm text-muted-foreground">{description}</span>
      </span>
      <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
