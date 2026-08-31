import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { getSession } from '../../../../../features/auth';
import { fetchCase, FormRuntime } from '../../../../../features/cases';
import { PageHeader } from '../../../../../features/shell';

interface PageProps {
  params: Promise<{ caseId: string }>;
}

export const metadata: Metadata = {
  title: 'Continue request: OrgFlow',
};

export default async function ContinueCasePage({ params }: PageProps) {
  const { caseId } = await params;
  const [detail, session] = await Promise.all([fetchCase(caseId), getSession()]);

  if (!detail || !session) {
    notFound();
  }

  // Sent back to the case rather than shown a form that cannot be saved.
  // The API refuses editing anything but a draft with 409, and arriving at
  // a dead form to discover that is worse than never being offered it
  // (the same reasoning amend/page.tsx already follows for a returned
  // case).
  if (detail.case.status !== 'draft' || detail.case.submittedByUserId !== session.user.userId) {
    redirect(`/cases/${caseId}`);
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={`Continue ${detail.document.name}`}
        description="Pick up where you left off. Nothing here has been submitted yet."
      />

      {/* The pinned document, not the current one: PRD.md §8.2 pins at
          draft creation, so continuing must not silently move the
          requester onto a newer version's questions than the ones a
          resumed answer was actually given against. */}
      <FormRuntime
        mode={{ kind: 'draft', caseId: detail.case.caseId }}
        document={detail.document}
        initialValues={detail.values}
        initialAttachments={detail.attachments}
        userId={session.user.userId}
        roles={session.roles}
      />
    </div>
  );
}
