import { Card, CardContent, CardHeader, CardTitle, EmptyState } from '@orgflow/ui';
import { ShieldOff } from 'lucide-react';
import type { Metadata } from 'next';

import { getSession } from '../../../features/auth';
import {
  ApproverLoadTable,
  ExportButton,
  StepDurationChart,
  TurnaroundSummary,
  VolumeChart,
  fetchApproverLoad,
  fetchBottlenecks,
  fetchOverviewReport,
} from '../../../features/reporting';
import { PageHeader } from '../../../features/shell';

export const metadata: Metadata = {
  title: 'Reports: OrgFlow',
};

const REPORT_ROLES = new Set(['processOwner', 'admin', 'owner']);

export default async function ReportsPage() {
  const session = await getSession();
  const canView = session?.roles.some((role) => REPORT_ROLES.has(role)) ?? false;

  if (!canView) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Reports" />
        <EmptyState
          icon={ShieldOff}
          title="Reporting access required"
          description="Viewing reports needs the process owner, admin or owner role. Ask an administrator to grant it if you need to see this."
        />
      </div>
    );
  }

  const [overview, bottlenecks, approverLoad] = await Promise.all([
    fetchOverviewReport(),
    fetchBottlenecks(),
    // Fetched only when the viewer already qualifies at the API (it 403s
    // otherwise and this turns that into null): calling it unconditionally
    // and hiding the result client-side would still ship the data.
    fetchApproverLoad(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        description="Volume, turnaround and bottlenecks across every process, for the last 90 days."
        actions={<ExportButton />}
      />

      <TurnaroundSummary
        completionRate={overview.completionRate}
        medianTurnaroundHours={overview.medianTurnaroundHours}
        p90TurnaroundHours={overview.p90TurnaroundHours}
      />

      <Card>
        <CardHeader>
          <CardTitle>Volume</CardTitle>
        </CardHeader>
        <CardContent>
          <VolumeChart volume={overview.volume} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bottlenecks</CardTitle>
        </CardHeader>
        <CardContent>
          <StepDurationChart steps={bottlenecks} />
        </CardContent>
      </Card>

      {approverLoad !== null ? (
        <Card>
          <CardHeader>
            <CardTitle>Approver load</CardTitle>
          </CardHeader>
          <CardContent>
            <ApproverLoadTable entries={approverLoad} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
