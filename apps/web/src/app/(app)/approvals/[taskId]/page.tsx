import { Alert, Card, CardContent, CardHeader, CardTitle } from '@orgflow/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DecisionForm, fetchTask, urgencyOf } from '../../../../features/approvals';
import { AttachmentList, fetchCase, formatDate, SubmittedValues } from '../../../../features/cases';
import { HOME_CRUMB, PageHeader } from '../../../../features/shell';

interface PageProps {
  params: Promise<{ taskId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { taskId } = await params;
  const detail = await fetchTask(taskId);
  return {
    title: detail ? `Decide ${detail.case.reference}: OrgFlow` : 'Not found: OrgFlow',
  };
}

export default async function DecisionPage({ params }: PageProps) {
  const { taskId } = await params;
  const detail = await fetchTask(taskId);

  if (!detail) {
    notFound();
  }

  // The case behind the task, for the pinned document that labels the
  // answers and for the prior decisions PRD.md §13.2 requires on this
  // screen. Seeing the task already implies being allowed to see the case
  // (the API checks case visibility to serve the task at all), so this
  // cannot leak anything the task detail did not.
  const caseDetail = await fetchCase(detail.case.caseId);
  const { task, step, requester } = detail;
  const urgency = urgencyOf(task.dueAt, new Date());

  const priorDecisions = (caseDetail?.timeline ?? []).filter(
    (entry) => entry.kind === 'decision' && entry.taskId !== task.taskId,
  );

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      {/* The process name, not case.title. PRD.md §4 takes a case's title
          from the form's designated field, so for the Laptop Request it is
          the stored option code ("mbp16"), which means nothing to an
          approver. The pinned document knows what the process is called. */}
      <PageHeader
        breadcrumbs={[
          HOME_CRUMB,
          { label: 'Approvals', href: '/approvals' },
          { label: detail.case.reference },
        ]}
        title={step?.name ?? task.stepName}
        description={`${detail.case.reference}${caseDetail ? ` · ${caseDetail.document.name}` : ''}`}
      />

      {step?.instructions ? <Alert>{step.instructions}</Alert> : null}

      {/* Everything needed to decide, on one screen, with no expanding and
          no navigating away (PRD.md §13.2). */}
      <Card>
        <CardContent className="p-5">
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Requester</dt>
              <dd className="text-sm">{requester?.displayName ?? 'Unknown'}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Department</dt>
              <dd className="text-sm">{requester?.department ?? 'Not recorded'}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Submitted</dt>
              <dd className="text-sm">
                {detail.case.submittedAt ? formatDate(detail.case.submittedAt) : 'Not recorded'}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Due</dt>
              <dd className="text-sm">{urgency.label}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What was asked for</CardTitle>
        </CardHeader>
        <CardContent>
          {caseDetail ? (
            <SubmittedValues document={caseDetail.document} values={detail.values} />
          ) : (
            <p className="text-sm text-muted-foreground">
              The submitted answers could not be loaded.
            </p>
          )}
        </CardContent>
      </Card>

      {caseDetail && caseDetail.attachments.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Attachments</CardTitle>
          </CardHeader>
          <CardContent>
            <AttachmentList attachments={caseDetail.attachments} />
          </CardContent>
        </Card>
      ) : null}

      {priorDecisions.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Decisions already made on this request</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col">
              {priorDecisions.map((entry) =>
                entry.kind === 'decision' ? (
                  <li
                    key={entry.taskId}
                    className="flex flex-col gap-1 border-b border-divider py-3 last:border-b-0"
                  >
                    <span className="text-sm font-medium">
                      {entry.stepName}: {entry.decision}
                    </span>
                    {entry.comment ? (
                      <span className="text-sm text-muted-foreground">{entry.comment}</span>
                    ) : null}
                  </li>
                ) : null,
              )}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Your decision</CardTitle>
        </CardHeader>
        <CardContent>
          {step ? (
            <DecisionForm
              taskId={task.taskId}
              reference={detail.case.reference}
              allowedDecisions={step.allowedDecisions}
              requireCommentOn={step.requireCommentOn}
              isClaimed={task.assigneeUserId !== null}
              canAct={detail.canAct}
            />
          ) : (
            <Alert variant="destructive">
              This task refers to a step that is not in the definition version the request is pinned
              to, so there is nothing to decide.
            </Alert>
          )}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        <Link href={`/cases/${detail.case.caseId}`} className="text-link hover:text-link-hover">
          View the full request history
        </Link>
      </p>
    </div>
  );
}
