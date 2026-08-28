import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { getSession } from '../../../../../features/auth';
import { fetchCase, FormRuntime, isReturnedToRequester } from '../../../../../features/cases';
import { PageHeader } from '../../../../../features/shell';

interface PageProps {
  params: Promise<{ caseId: string }>;
}

export const metadata: Metadata = {
  title: 'Amend request: OrgFlow',
};

export default async function AmendCasePage({ params }: PageProps) {
  const { caseId } = await params;
  const [detail, session] = await Promise.all([fetchCase(caseId), getSession()]);

  if (!detail || !session) {
    notFound();
  }

  // Sent back to the case rather than shown a form that cannot be
  // submitted. The API refuses a resubmission on anything but a returned
  // case with 409, and arriving at a dead form to discover that is worse
  // than never being offered it.
  if (
    !isReturnedToRequester(detail.case) ||
    detail.case.submittedByUserId !== session.user.userId
  ) {
    redirect(`/cases/${caseId}`);
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={`Amend ${detail.case.reference}`}
        description="Change what the approver asked you to, then send it back. The reference stays the same."
      />

      {/* The pinned document, not the current one. PRD.md §8.4: a returned
          case is still assessed against the form the requester originally
          saw, so amending it must not silently move them onto a newer
          version's questions. */}
      <FormRuntime
        mode={{ kind: 'resubmit', caseId: detail.case.caseId, reference: detail.case.reference }}
        document={detail.document}
        initialValues={detail.values}
        initialAttachments={detail.attachments}
        userId={session.user.userId}
        roles={session.roles}
      />
    </div>
  );
}
