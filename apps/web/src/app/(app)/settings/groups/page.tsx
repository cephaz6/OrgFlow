import { Card, CardContent, CardHeader, CardTitle, EmptyState } from '@orgflow/ui';
import { ShieldOff } from 'lucide-react';
import type { Metadata } from 'next';

import { getSession } from '../../../../features/auth';
import { fetchGroups, GroupForm, GroupList } from '../../../../features/groups';
import { PageHeader } from '../../../../features/shell';

export const metadata: Metadata = {
  title: 'Groups: OrgFlow',
};

export default async function GroupsPage() {
  // getSession() cannot be null here: the (app) layout redirects when
  // there is no session. GET /groups itself stays open to any signed-in
  // member (ADR-0027's owning-group picklist needs that), so unlike
  // members/identity-providers this page cannot lean on a 403 from its own
  // list endpoint to decide whether to render; it gates on the roles claim
  // directly instead, the same trust nav.ts's own visibleNavGroups already
  // places in it. Every mutation below is still enforced server-side
  // regardless of what this check decides.
  const session = await getSession();
  const isAdministrator = session!.roles.some((role) => role === 'admin' || role === 'owner');

  if (!isAdministrator) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Groups" />
        <EmptyState
          icon={ShieldOff}
          title="Admin access required"
          description="Managing groups needs the admin or owner role. Ask an administrator to grant it if you need to see this."
        />
      </div>
    );
  }

  const groups = await fetchGroups();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Groups"
        description="Pools of members a workflow step can assign a task to, or that a process definition can be owned by."
      />

      <Card>
        <CardHeader>
          <CardTitle>Create a group</CardTitle>
        </CardHeader>
        <CardContent>
          <GroupForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Existing groups</CardTitle>
        </CardHeader>
        <CardContent>
          <GroupList groups={groups} />
        </CardContent>
      </Card>
    </div>
  );
}
