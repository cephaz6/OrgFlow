import { Button, Card, CardContent, EmptyState } from '@orgflow/ui';
import { FilePlus2, Wrench } from 'lucide-react';
import Link from 'next/link';

import { DefinitionStatusBadge } from './definition-status-badge';
import type { ManagedDefinition } from './types';

export interface ManageListProps {
  definitions: ManagedDefinition[];
}

export function ManageList({ definitions }: ManageListProps) {
  if (definitions.length === 0) {
    return (
      <EmptyState
        icon={Wrench}
        title="No processes yet"
        description="Build a form and workflow for the first thing your organisation wants to run through OrgFlow."
        action={
          <Button asChild>
            <Link href="/processes/new">
              <FilePlus2 aria-hidden="true" className="h-4 w-4" />
              New process
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {definitions.map((definition) => (
        <Card key={definition.definitionId}>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex flex-1 flex-col gap-1">
              <Link
                href={`/processes/${definition.definitionId}`}
                className="font-medium hover:underline"
              >
                {definition.name}
              </Link>
              {definition.description ? (
                <p className="text-sm text-muted-foreground">{definition.description}</p>
              ) : null}
            </div>
            <DefinitionStatusBadge status={definition.status} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
