import { Card, CardContent, CardHeader, CardTitle, EmptyState } from '@orgflow/ui';
import { ShieldOff } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getSession } from '../../../../features/auth';
import {
  ExportButton,
  StepDurationChart,
  TurnaroundSummary,
  fetchDefinitionReport,
} from '../../../../features/reporting';
import { PageHeader } from '../../../../features/shell';

interface PageProps {
  params: Promise<{ definitionId: string }>;
}

const REPORT_ROLES = new Set(['processOwner', 'admin', 'owner']);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { definitionId } = await params;
  const report = await fetchDefinitionReport(definitionId);
  return { title: report ? `${report.definitionName}: OrgFlow` : 'Not found: OrgFlow' };
}

export default async function DefinitionReportPage({ params }: PageProps) {
  const { definitionId } = await params;
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

  const report = await fetchDefinitionReport(definitionId);
  if (!report) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={report.definitionName}
        description="Turnaround, bottlenecks and rejection reasons for this process, for the last 90 days."
        actions={<ExportButton definitionId={definitionId} />}
      />

      <TurnaroundSummary
        completionRate={report.completionRate}
        medianTurnaroundHours={report.medianTurnaroundHours}
        p90TurnaroundHours={report.p90TurnaroundHours}
      />

      <Card>
        <CardHeader>
          <CardTitle>Step duration</CardTitle>
        </CardHeader>
        <CardContent>
          <StepDurationChart steps={report.steps} />
        </CardContent>
      </Card>

      {report.rejectionReasons.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Rejection reasons</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Rejections by step</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="px-6 py-3 font-medium">
                    Step
                  </th>
                  <th scope="col" className="px-6 py-3 font-medium">
                    Rejections
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.rejectionReasons.map((row) => (
                  <tr key={row.stepKey} className="border-b border-divider last:border-b-0">
                    <th scope="row" className="px-6 py-3 text-left font-normal">
                      {row.stepName}
                    </th>
                    <td className="px-6 py-3">{row.rejectedCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
