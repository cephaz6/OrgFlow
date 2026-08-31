import Link from 'next/link';

import { ProcessIcon, type CatalogueEntry } from '../catalogue';

export interface QuickStartProps {
  entries: CatalogueEntry[];
  limit?: number;
}

// PRD.md §13.2 asks for "quick-start tiles for frequent processes". The
// ranking (sortCatalogueByFrequency) happens at the call site, not here:
// this component only ever renders the list it is given, capped so the
// dashboard stays a summary.
export function QuickStart({ entries, limit = 4 }: QuickStartProps) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {entries.slice(0, limit).map((entry) => (
        <li key={entry.definitionId}>
          <Link
            href={`/cases/new/${entry.key}`}
            className="flex h-full items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-input hover:bg-accent"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary-subtle-foreground">
              <ProcessIcon name={entry.icon} className="h-4 w-4" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm font-medium">{entry.name}</span>
              <span className="text-xs text-muted-foreground">Start a request</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
