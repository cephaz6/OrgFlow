import { Card, CardContent, CardHeader, CardTitle, EmptyState } from '@orgflow/ui';
import { FileSearch, ShieldOff } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { fetchSubjectExport } from '../../../../features/data-protection';
import { DownloadExportButton } from '../../../../features/data-protection/download-export-button';
import { HOME_CRUMB, PageHeader } from '../../../../features/shell';
import { formatDate, formatDateTime } from '../../../../lib/format';

export const metadata: Metadata = {
  title: 'Subject access export: OrgFlow',
};

interface PageProps {
  searchParams: Promise<{ userId?: string }>;
}

export default async function DataProtectionPage({ searchParams }: PageProps) {
  const { userId } = await searchParams;

  if (!userId) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          breadcrumbs={[
            HOME_CRUMB,
            { label: 'Members', href: '/settings/members' },
            { label: 'Active members', href: '/settings/members/directory' },
          ]}
          title="Subject access export"
          description="All data OrgFlow holds relating to one member: cases they submitted, tasks they acted on, their audited actions, and their uploads."
        />
        <EmptyState
          icon={FileSearch}
          title="No member selected"
          description="Start from the active members list, and choose Export data for the person the request is about."
        />
        <Link href="/settings/members/directory" className="text-sm font-medium underline">
          Go to active members
        </Link>
      </div>
    );
  }

  const result = await fetchSubjectExport(userId);

  if (result.kind === 'forbidden') {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          breadcrumbs={[
            HOME_CRUMB,
            { label: 'Members', href: '/settings/members' },
            { label: 'Active members', href: '/settings/members/directory' },
          ]}
          title="Subject access export"
        />
        <EmptyState
          icon={ShieldOff}
          title="Admin access required"
          description="A subject access export needs the admin or owner role. Ask an administrator to run it if you need to see this."
        />
      </div>
    );
  }

  if (result.kind === 'not-found') {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          breadcrumbs={[
            HOME_CRUMB,
            { label: 'Members', href: '/settings/members' },
            { label: 'Active members', href: '/settings/members/directory' },
          ]}
          title="Subject access export"
        />
        <EmptyState
          icon={FileSearch}
          title="No such member"
          description="This person is not a member of this organisation."
        />
      </div>
    );
  }

  const { data } = result;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        breadcrumbs={[
          HOME_CRUMB,
          { label: 'Members', href: '/settings/members' },
          { label: 'Active members', href: '/settings/members/directory' },
        ]}
        title={`Subject access export: ${data.user.displayName}`}
        description={`${data.user.email}. Generated ${formatDateTime(data.exportedAt)}.`}
      />

      <DownloadExportButton data={data} />

      <Card>
        <CardHeader>
          <CardTitle>Membership</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Roles</dt>
            <dd>{data.membership.roles.join(', ')}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd>{data.membership.status}</dd>
            <dt className="text-muted-foreground">Department</dt>
            <dd>{data.membership.department ?? 'Not set'}</dd>
            <dt className="text-muted-foreground">Joined</dt>
            <dd>{formatDate(data.membership.joinedAt)}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cases submitted ({data.casesSubmitted.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {data.casesSubmitted.length === 0 ? (
            <p className="text-sm text-muted-foreground">No cases submitted.</p>
          ) : (
            data.casesSubmitted.map((c) => (
              <div key={c.caseId} className="rounded-md border border-border p-3 text-sm">
                <p className="font-medium">
                  {c.reference}: {c.title}
                </p>
                <p className="text-muted-foreground">
                  {c.status}
                  {c.outcome ? `, ${c.outcome}` : ''}
                  {c.submittedAt ? `. Submitted ${formatDate(c.submittedAt)}` : ''}
                  {c.redactedAt ? `. Redacted ${formatDate(c.redactedAt)}` : ''}
                </p>
                {Object.keys(c.values).length > 0 ? (
                  <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">
                    {JSON.stringify(c.values, null, 2)}
                  </pre>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tasks ({data.tasks.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {data.tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks.</p>
          ) : (
            data.tasks.map((task) => (
              <div key={task.taskId} className="rounded-md border border-border p-3 text-sm">
                <p className="font-medium">{task.stepName}</p>
                <p className="text-muted-foreground">
                  {task.status}
                  {task.decision ? `, decided ${task.decision}` : ''}
                  {task.completedAt ? ` on ${formatDate(task.completedAt)}` : ''}
                </p>
                {task.comment ? <p className="mt-1">{task.comment}</p> : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit events ({data.auditEvents.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {data.auditEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No audited actions.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {data.auditEvents.map((event) => (
                <li key={event.auditEventId}>
                  {formatDateTime(event.occurredAt)}: {event.action} ({event.entityType})
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Attachments uploaded ({data.attachmentsUploaded.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {data.attachmentsUploaded.length === 0 ? (
            <p className="text-sm text-muted-foreground">No attachments uploaded.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {data.attachmentsUploaded.map((attachment) => (
                <li key={attachment.attachmentId}>
                  {attachment.filename} ({attachment.scanStatus})
                  {attachment.deletedAt ? ', deleted' : ''}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
