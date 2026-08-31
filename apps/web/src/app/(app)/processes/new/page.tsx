import type { Metadata } from 'next';

import { CreateProcessForm } from '../../../../features/form-builder';
import { fetchGroups } from '../../../../features/groups';
import { HOME_CRUMB, PageHeader } from '../../../../features/shell';

export const metadata: Metadata = {
  title: 'New process — OrgFlow',
};

export default async function NewProcessPage() {
  const groups = await fetchGroups();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[HOME_CRUMB, { label: 'Processes', href: '/processes' }]}
        title="New process"
        description="Give it a name and a reference prefix. Everything else can be built and changed before it is published."
      />
      <CreateProcessForm groups={groups} />
    </div>
  );
}
