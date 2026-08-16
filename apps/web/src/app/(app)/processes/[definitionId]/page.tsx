import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { getSession } from '../../../../features/auth';
import { Builder, fetchDraft } from '../../../../features/form-builder';
import { PageHeader } from '../../../../features/shell';
import { ApiError } from '../../../../lib/api-error';

interface PageProps {
  params: Promise<{ definitionId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { definitionId } = await params;
  try {
    const draft = await fetchDraft(definitionId);
    return { title: `${draft.definition.name} — OrgFlow` };
  } catch {
    return { title: 'Process — OrgFlow' };
  }
}

export default async function ProcessBuilderPage({ params }: PageProps) {
  const { definitionId } = await params;
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  let draft;
  try {
    draft = await fetchDraft(definitionId);
  } catch (err) {
    // The API returns 404, never 403, for a definition this session cannot
    // manage (apps/api/src/routes/process-definitions.ts's
    // requireManageableDefinition), so the two cases are indistinguishable
    // here as well.
    if (err instanceof ApiError && err.status === 404) {
      notFound();
    }
    throw err;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={draft.definition.name}
        description="Build the form here. The workflow that routes a submitted request is set up separately."
      />
      <Builder initial={draft} userId={session.user.userId} />
    </div>
  );
}
