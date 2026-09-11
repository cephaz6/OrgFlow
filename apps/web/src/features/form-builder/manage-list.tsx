import { Button, Card, CardContent, EmptyState } from '@orgflow/ui';
import { ChartNoAxesCombined, FilePlus2, Wrench } from 'lucide-react';
import Link from 'next/link';

import { formatDate } from '../../lib/format';
import type { Group } from '../groups';
import { DefinitionStatusBadge } from './definition-status-badge';
import type { ManagedDefinition } from './types';

export interface ManageListProps {
  definitions: ManagedDefinition[];
  groups: Group[];
}

export function ManageList({ definitions, groups }: ManageListProps) {
  const groupNameById = new Map(groups.map((group) => [group.groupId, group.name]));
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
          {/* flex-wrap and min-w-0 together are what let this row reflow at
              320px, WCAG 2.2 AA's reflow width. A flex item defaults to
              min-width:auto, so the text column refused to shrink below its
              longest line and pushed the report link and the status badge
              past the viewport; min-w-0 lets it narrow, and flex-wrap lets
              the controls drop onto their own line once it cannot narrow
              further. */}
          <CardContent className="flex flex-wrap items-center gap-4 p-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Link
                href={`/processes/${definition.definitionId}`}
                className="font-medium hover:underline"
              >
                {definition.name}
              </Link>
              {definition.description ? (
                <p className="text-sm text-muted-foreground">{definition.description}</p>
              ) : null}
              {definition.owningGroupId ? (
                <p className="text-sm text-muted-foreground">
                  Owning group: {groupNameById.get(definition.owningGroupId) ?? 'Unknown group'}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Created {formatDate(definition.createdAt)}
              </p>
            </div>
            {/* A draft has never been published, so no case has ever run
                against it and its report would be nothing but empty states.
                Offering the link anyway would read as a broken report rather
                than an unused one, the same reasoning nav.ts applies to
                items pointing at pages that do not exist. */}
            {definition.status !== 'draft' ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/reports/${definition.definitionId}`}>
                  <ChartNoAxesCombined aria-hidden="true" className="h-4 w-4" />
                  Report
                  {/* Every row's link would otherwise be called "Report",
                      which is useless to anyone listing the page's links. */}
                  <span className="sr-only"> for {definition.name}</span>
                </Link>
              </Button>
            ) : null}
            <DefinitionStatusBadge status={definition.status} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
