import { Card, CardContent, CardHeader, CardTitle, EmptyState } from '@orgflow/ui';
import { ShieldOff } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getSession } from '../../../../../features/auth';
import { fetchGroupDetail, GroupMembers } from '../../../../../features/groups';
import { fetchMembers } from '../../../../../features/members';
import { HOME_CRUMB, PageHeader } from '../../../../../features/shell';

interface PageProps {
  params: Promise<{ groupId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { groupId } = await params;
  const group = await fetchGroupDetail(groupId);
  return { title: group ? `${group.name}: OrgFlow` : 'Group: OrgFlow' };
}

export default async function GroupDetailPage({ params }: PageProps) {
  const { groupId } = await params;

  // Same reasoning as the groups list page: gated on the roles claim,
  // since GET /groups/:groupId's own 403 would otherwise be
  // indistinguishable here from a genuinely unknown group id.
  const session = await getSession();
  const isAdministrator = session!.roles.some((role) => role === 'admin' || role === 'owner');

  if (!isAdministrator) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          breadcrumbs={[HOME_CRUMB, { label: 'Groups', href: '/settings/groups' }]}
          title="Group"
        />
        <EmptyState
          icon={ShieldOff}
          title="Admin access required"
          description="Managing groups needs the admin or owner role. Ask an administrator to grant it if you need to see this."
        />
      </div>
    );
  }

  const group = await fetchGroupDetail(groupId);
  if (!group) {
    notFound();
  }

  // Every active member not already in the group, for the add picker: a
  // second, independent fetch, mirroring the member profile editor's own
  // line-manager picker (features/members/member-list.tsx).
  const activeMembers = await fetchMembers({ status: 'active', limit: 200 });
  const memberIds = new Set(group.members.map((member) => member.userId));
  const candidateMembers = (activeMembers?.members ?? [])
    .filter((member) => !memberIds.has(member.userId))
    .map((member) => ({
      userId: member.userId,
      displayName: member.displayName,
      email: member.email,
    }));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        breadcrumbs={[HOME_CRUMB, { label: 'Groups', href: '/settings/groups' }]}
        title={group.name}
        description={
          group.description ? `${group.description} (key: ${group.key})` : `Key: ${group.key}`
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent>
          <GroupMembers
            groupId={group.groupId}
            members={group.members}
            candidateMembers={candidateMembers}
          />
        </CardContent>
      </Card>
    </div>
  );
}
