import { Alert, Button, Card, CardContent, CardHeader, CardTitle } from '@orgflow/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  CancelCase,
  CaseStatusBadge,
  CaseTimeline,
  fetchCase,
  formatDate,
  isReturnedToRequester,
  SubmittedValues,
  TaskStatusBadge,
} from '../../../../features/cases';
import { PageHeader } from '../../../../features/shell';
import { getSession } from '../../../../features/auth';

interface PageProps {
  params: Promise<{ caseId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { caseId } = await params;
  const detail = await fetchCase(caseId);
  return { title: detail ? `${detail.case.reference} — OrgFlow` : 'Not found — OrgFlow' };
}

const TERMINAL_STEPS = new Set(['$completed', '$rejected', '$cancelled', '$returnedToRequester']);

export default async function CaseDetailPage({ params }: PageProps) {
  const { caseId } = await params;
  const [detail, session] = await Promise.all([fetchCase(caseId), getSession()]);

  // ADR-0015: a case in another organisation and a case this user may not
  // see both arrive as 404, and neither is distinguished from one that does
  // not exist. Nothing here needs to know which it was.
  if (!detail) {
    notFound();
  }

  const { case: found, values, tasks, timeline, document } = detail;
  const returned = isReturnedToRequester(found);
  const isRequester = session?.user.userId === found.submittedByUserId;
  const isOpen = found.status === 'active' || found.status === 'unassigned';

  const currentStep = document.workflow.steps.find((step) => step.key === found.currentStepKey);
  const openTasks = tasks.filter((task) => task.status === 'pending' || task.status === 'claimed');

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={found.reference}
        description={document.name}
        actions={
          <CaseStatusBadge
            status={found.status}
            outcome={found.outcome}
            returnedToRequester={returned}
          />
        }
      />

      {returned ? (
        <Alert variant="destructive">
          This request was returned to you for amendment. Change what is needed and send it back; it
          keeps the same reference and is still assessed against the form you originally saw.
        </Alert>
      ) : null}

      <Card>
        <CardContent className="p-5">
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Submitted</dt>
              <dd className="text-sm">
                {found.submittedAt ? formatDate(found.submittedAt) : 'Not yet submitted'}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                {isOpen ? 'Currently with' : 'Closed'}
              </dt>
              <dd className="text-sm">
                {isOpen
                  ? returned
                    ? 'You, for amendment'
                    : (currentStep?.name ?? 'Nobody yet')
                  : found.completedAt
                    ? formatDate(found.completedAt)
                    : 'Not recorded'}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Due</dt>
              <dd className="text-sm">{found.dueAt ? formatDate(found.dueAt) : 'No deadline'}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Progress across the pinned workflow. Steps a branch skipped are
          shown as skipped rather than hidden, because "why did this not go
          to finance" is a question the requester will otherwise ask a
          human. */}
      <Card>
        <CardHeader>
          <CardTitle>Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col">
            {document.workflow.steps
              .filter((step) => !TERMINAL_STEPS.has(step.key))
              .map((step) => {
                const task = tasks.find((entry) => entry.stepKey === step.key);
                return (
                  <li
                    key={step.key}
                    className="flex items-center gap-3 border-b border-divider py-3 last:border-b-0"
                  >
                    <span className="flex-1 text-sm font-medium">{step.name}</span>
                    {task ? (
                      <TaskStatusBadge status={task.status} />
                    ) : (
                      <span className="text-xs text-muted-foreground">Not reached</span>
                    )}
                  </li>
                );
              })}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What you asked for</CardTitle>
        </CardHeader>
        <CardContent>
          <SubmittedValues document={document} values={values} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          <CaseTimeline entries={timeline} document={document} />
        </CardContent>
      </Card>

      {/* Actions are the requester's only. Approving and rejecting belong to
          whoever holds the task, on the decision screen, and PRD.md §12.3
          insists the two permissions stay separate. */}
      {isRequester && isOpen ? (
        <div className="flex flex-wrap items-start gap-3">
          {returned ? (
            <Button asChild>
              <Link href={`/cases/${found.caseId}/amend`}>Amend and resubmit</Link>
            </Button>
          ) : null}
          <CancelCase caseId={found.caseId} reference={found.reference} />
        </div>
      ) : null}

      {openTasks.length === 0 && isOpen && !returned ? (
        <Alert>
          Nobody is currently assigned to this request. An administrator needs to assign it before
          it can move on.
        </Alert>
      ) : null}
    </div>
  );
}
