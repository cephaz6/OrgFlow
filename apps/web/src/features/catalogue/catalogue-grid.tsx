import { Card } from '@orgflow/ui';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { formatDate } from '../../lib/format';
import type { CatalogueEntry } from './api';
import { ProcessIcon } from './process-icon';

export interface CatalogueGridProps {
  entries: CatalogueEntry[];
}

export function CatalogueGrid({ entries }: CatalogueGridProps) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {entries.map((entry) => (
        <li key={entry.definitionId}>
          <Card className="h-full transition-colors hover:border-input">
            {/* The whole card is the target, but only the process name is
                  the link text: a link labelled with the description as
                  well would read the entire card aloud before saying where
                  it goes. The inset span stretches the hit area without
                  enlarging the accessible name. */}
            <Link
              href={`/catalogue/${entry.key}`}
              className="relative flex h-full items-start gap-3 p-5"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary-subtle-foreground">
                <ProcessIcon name={entry.icon} className="h-4 w-4" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-medium">
                  {entry.name}
                  <span className="absolute inset-0" />
                </span>
                {entry.description ? (
                  <span className="text-sm text-muted-foreground">{entry.description}</span>
                ) : null}
                {entry.category ? (
                  <span className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
                    {entry.category}
                  </span>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  Added {formatDate(entry.createdAt)}
                </span>
              </span>
              <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          </Card>
        </li>
      ))}
    </ul>
  );
}
