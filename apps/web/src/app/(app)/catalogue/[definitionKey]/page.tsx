import { Button, Card, CardContent, CardHeader, CardTitle } from '@orgflow/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { fetchDefinitionByKey, ProcessIcon } from '../../../../features/catalogue';
import { PageHeader } from '../../../../features/shell';

interface PageProps {
  params: Promise<{ definitionKey: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { definitionKey } = await params;
  const detail = await fetchDefinitionByKey(definitionKey);
  return { title: detail ? `${detail.definition.name} — OrgFlow` : 'Not found — OrgFlow' };
}

const STEP_TYPE_LABELS: Record<string, string> = {
  approval: 'Approval',
  action: 'Action',
  acknowledgement: 'Acknowledgement',
  automatic: 'Automatic',
};

export default async function ProcessDetailPage({ params }: PageProps) {
  const { definitionKey } = await params;
  const detail = await fetchDefinitionByKey(definitionKey);

  // The API already returns 404 rather than 403 for a definition in another
  // organisation (PRD.md §11.10), so this covers both "no such process" and
  // "not yours" without distinguishing them here either.
  if (!detail) {
    notFound();
  }

  const { definition, version, document } = detail;
  const fieldCount = document.form.sections.reduce(
    (total, section) => total + section.fields.length,
    0,
  );

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={definition.name}
        {...(definition.description ? { description: definition.description } : {})}
        actions={
          <Button asChild>
            <Link href={`/cases/new/${definition.key}`}>Start a request</Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="flex items-start gap-4 p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary-subtle-foreground">
            <ProcessIcon name={definition.icon} className="h-5 w-5" />
          </span>
          <dl className="grid flex-1 gap-x-8 gap-y-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Category</dt>
              <dd className="text-sm">{definition.category ?? 'Uncategorised'}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Version</dt>
              {/* Monospace for a technical identifier, as the reference
                  design does for reference strings. */}
              <dd className="font-mono text-sm">v{version.versionNumber}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Questions</dt>
              <dd className="text-sm">{fieldCount}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What happens after you submit</CardTitle>
        </CardHeader>
        <CardContent>
          {/* An ordered list, because the order is the information. Steps
              can branch, so this is the shape of the process rather than a
              promise about the route any one request takes. */}
          <ol className="flex flex-col">
            {document.workflow.steps.map((step, index) => (
              <li
                key={step.key}
                className="flex items-baseline gap-3 border-b border-divider py-3 last:border-b-0"
              >
                <span className="font-mono text-xs text-muted-foreground">{index + 1}</span>
                <span className="flex flex-1 flex-col gap-1">
                  <span className="text-sm font-medium">{step.name}</span>
                  {step.instructions ? (
                    <span className="text-sm text-muted-foreground">{step.instructions}</span>
                  ) : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  {STEP_TYPE_LABELS[step.type] ?? step.type}
                  {step.sla ? ` · ${step.sla.durationHours}h` : ''}
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
