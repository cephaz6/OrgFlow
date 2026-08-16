import { EmptyState } from '@orgflow/ui';
import { LayoutDashboard } from 'lucide-react';
import type { Metadata } from 'next';

import { PageHeader } from '../../features/shell';

export const metadata: Metadata = {
  title: 'Dashboard — OrgFlow',
};

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="Approvals waiting on you and the requests you have open."
      />
      <EmptyState
        icon={LayoutDashboard}
        title="Nothing here yet"
        description="Requests you submit and tasks assigned to you will appear here once your organisation has a process to run."
      />
    </div>
  );
}
