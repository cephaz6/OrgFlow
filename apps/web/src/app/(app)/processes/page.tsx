import { Button, EmptyState } from '@orgflow/ui';
import { FilePlus2, ShieldOff } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { getSession } from '../../../features/auth';
import { fetchManagedDefinitions, ManageList } from '../../../features/form-builder';
import { fetchGroups } from '../../../features/groups';
import { PageHeader } from '../../../features/shell';

export const metadata: Metadata = {
  title: 'Processes — OrgFlow',
};

const MANAGE_ROLES = new Set(['processOwner', 'admin', 'owner']);

export default async function ProcessesPage() {
  // getSession() cannot return null here: the (app) layout already redirects
  // when there is no session, and this is what tells the compiler that.
  const session = await getSession();
  const canManage = session?.roles.some((role) => MANAGE_ROLES.has(role)) ?? false;

  if (!canManage) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Processes" />
        <EmptyState
          icon={ShieldOff}
          title="Process owner access required"
          description="Building or editing a process needs the process owner, admin or owner role. Ask an administrator to grant it if you need to set up a new process."
        />
      </div>
    );
  }

  const [definitions, groups] = await Promise.all([fetchManagedDefinitions(), fetchGroups()]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Processes"
        description="The forms and workflows you own, at every stage from draft to published."
        actions={
          <Button asChild>
            <Link href="/processes/new">
              <FilePlus2 aria-hidden="true" className="h-4 w-4" />
              New process
            </Link>
          </Button>
        }
      />
      <ManageList definitions={definitions} groups={groups} />
    </div>
  );
}
