import { StatusBadge } from '@orgflow/ui';
import Link from 'next/link';

import { formatDate } from '../cases';
import type { TaskQueueEntry } from './types';
import { byUrgency, urgencyOf } from './urgency';
import { taskDestination } from './task-destination';
import { URGENCY_PRESENTATION } from './urgency-presentation';

export interface ApprovalQueueProps {
  entries: TaskQueueEntry[];
  now: Date;
  // Rendered on the claimable queue, where a row is work nobody has taken
  // rather than work assigned to you.
  claimable?: boolean;
}

export function ApprovalQueue({ entries, now, claimable = false }: ApprovalQueueProps) {
  const sorted = byUrgency(entries);

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-3xl border-collapse text-sm">
        <caption className="sr-only">
          {claimable
            ? 'Work available to claim, most urgent first'
            : 'Approvals waiting on you, most urgent first'}
        </caption>
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th scope="col" className="px-4 py-3 font-medium">
              Reference
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Step
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Requester
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Submitted
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Urgency
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((entry) => {
            const { urgency, label } = urgencyOf(entry.dueAt, now);
            const { tone, icon } = URGENCY_PRESENTATION[urgency];

            return (
              <tr key={entry.taskId} className="border-b border-divider last:border-b-0">
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  <Link
                    href={taskDestination(entry)}
                    className="font-mono text-link underline-offset-4 hover:text-link-hover hover:underline"
                  >
                    {entry.caseReference}
                  </Link>
                </th>
                <td className="px-4 py-3">{entry.stepName}</td>
                <td className="px-4 py-3">{entry.requesterName}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(entry.createdAt)}</td>
                <td className="px-4 py-3">
                  {/* Icon plus words, never a bare colour: PRD.md §13.2
                      calls this indicator out by name, and this is the
                      screen where getting it wrong costs the most. */}
                  <StatusBadge tone={tone} icon={icon} label={label} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
