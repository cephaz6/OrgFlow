import type { Metadata } from 'next';

import { CreateProcessForm } from '../../../../features/form-builder';
import { PageHeader } from '../../../../features/shell';

export const metadata: Metadata = {
  title: 'New process — OrgFlow',
};

export default function NewProcessPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New process"
        description="Give it a name and a reference prefix. Everything else can be built and changed before it is published."
      />
      <CreateProcessForm />
    </div>
  );
}
