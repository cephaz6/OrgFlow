import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { getSession } from '../../../../../features/auth';
import { fetchDefinitionByKey } from '../../../../../features/catalogue';
import { FormRuntime } from '../../../../../features/cases';
import { PageHeader } from '../../../../../features/shell';

interface PageProps {
  params: Promise<{ definitionKey: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { definitionKey } = await params;
  const detail = await fetchDefinitionByKey(definitionKey);
  return { title: detail ? `New ${detail.definition.name} — OrgFlow` : 'Not found — OrgFlow' };
}

export default async function NewCasePage({ params }: PageProps) {
  const { definitionKey } = await params;

  const [session, detail] = await Promise.all([getSession(), fetchDefinitionByKey(definitionKey)]);

  // The layout above already redirects an unauthenticated visitor, so this
  // is a type narrowing rather than a second guard.
  if (!session) {
    redirect('/login');
  }

  if (!detail) {
    notFound();
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={detail.definition.name}
        {...(detail.definition.description ? { description: detail.definition.description } : {})}
      />

      {/* The document is passed whole to the client. It is the published
          definition every member of the organisation can already read
          through the catalogue, so nothing crosses a boundary here that the
          API does not already expose. */}
      <FormRuntime
        definitionId={detail.definition.definitionId}
        definitionKey={detail.definition.key}
        document={detail.document}
        userId={session.user.userId}
        roles={session.roles}
      />
    </div>
  );
}
