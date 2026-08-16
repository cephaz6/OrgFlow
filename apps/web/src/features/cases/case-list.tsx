import Link from 'next/link';

import type { CaseResponse } from './types';
import { CaseStatusBadge } from './case-status';
import { formatDate } from './format';

export interface CaseListProps {
  cases: CaseResponse[];
  // definitionId to process name. Built by the page from the catalogue,
  // because the case list projection carries only the id.
  processNames: Record<string, string>;
}

export function CaseList({ cases, processNames }: CaseListProps) {
  return (
    // Scrolls within itself rather than pushing the page sideways on a
    // narrow viewport. A table is the right element here: these are records
    // with shared columns, and a screen reader user gets row and column
    // headers to navigate by, which a stack of divs would not give them.
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-2xl border-collapse text-sm">
        <caption className="sr-only">Requests you have submitted, most recent first</caption>
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th scope="col" className="px-4 py-3 font-medium">
              Reference
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Process
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Status
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Submitted
            </th>
          </tr>
        </thead>
        <tbody>
          {cases.map((entry) => (
            <tr key={entry.caseId} className="border-b border-divider last:border-b-0">
              <th scope="row" className="px-4 py-3 text-left font-normal">
                <Link
                  href={`/cases/${entry.caseId}`}
                  className="font-mono text-link underline-offset-4 hover:text-link-hover hover:underline"
                >
                  {entry.reference}
                </Link>
              </th>
              <td className="px-4 py-3">{processNames[entry.definitionId] ?? entry.title}</td>
              <td className="px-4 py-3">
                <CaseStatusBadge
                  status={entry.status}
                  outcome={entry.outcome}
                  returnedToRequester={isReturnedToRequester(entry)}
                />
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {entry.submittedAt ? formatDate(entry.submittedAt) : 'Not submitted'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// A returned case is `active` with no current step: the engine parks it on
// the requester rather than on a workflow step. Nothing in the status field
// says so, which is why it is computed here (PRD.md §8.4).
export function isReturnedToRequester(entry: CaseResponse): boolean {
  return entry.status === 'active' && entry.currentStepKey === null && entry.submittedAt !== null;
}
