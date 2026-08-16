import Link from 'next/link';

import { CaseStatusBadge, formatDate, isReturnedToRequester, type CaseResponse } from '../cases';
import { selectOpenRequests } from './select-open-requests';

export interface YourRequestsProps {
  cases: CaseResponse[];
  processNames: Record<string, string>;
  limit?: number;
}

export function YourRequests({ cases, processNames, limit = 5 }: YourRequestsProps) {
  const open = selectOpenRequests(cases);
  const shown = open.slice(0, limit);

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col">
        {shown.map((entry) => (
          <li key={entry.caseId} className="border-b border-divider last:border-b-0">
            <Link
              href={`/cases/${entry.caseId}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 transition-colors hover:bg-accent"
            >
              <span className="font-mono text-sm text-link">{entry.reference}</span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {processNames[entry.definitionId] ?? entry.title}
              </span>
              <span className="text-sm text-muted-foreground">
                {entry.submittedAt ? formatDate(entry.submittedAt) : 'Draft'}
              </span>
              <CaseStatusBadge
                status={entry.status}
                outcome={entry.outcome}
                returnedToRequester={isReturnedToRequester(entry)}
              />
            </Link>
          </li>
        ))}
      </ul>

      {open.length > shown.length ? (
        <Link
          href="/cases"
          className="border-t border-divider px-5 py-3 text-sm text-link hover:text-link-hover"
        >
          View all {open.length} open requests
        </Link>
      ) : null}
    </div>
  );
}
