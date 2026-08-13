import { EmptyState } from '@orgflow/ui';
import { LayoutDashboard } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard — OrgFlow',
};

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <EmptyState
        icon={LayoutDashboard}
        title="Nothing here yet"
        description="Requests you submit and tasks assigned to you will appear here once your organisation has a process to run."
      />
    </div>
  );
}
