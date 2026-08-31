'use client';

import { StatusBadge } from '@orgflow/ui';
import Link from 'next/link';
import { useRef } from 'react';

import { formatDate } from '../../lib/format';
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
  // One ref per row's reference link, the thing arrow-key navigation moves
  // focus between. A plain array keyed by index rather than by taskId: the
  // list is re-sorted (not re-ordered independently) on every render, so
  // index alignment with `sorted` is exact for the lifetime of one render.
  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  // PRD.md §13.2: "keyboard navigable: arrow keys between rows, Enter to
  // open". Enter needs no handling of its own here: once a row's reference
  // link holds focus, a native anchor already activates on Enter. This
  // only has to move focus itself. Attached to each link rather than the
  // tbody: jsx-a11y's no-noninteractive-element-interactions rule refuses
  // a listener on a non-interactive container, and the link is already the
  // interactive element whose own keyboard behaviour this augments.
  function handleKeyDown(event: React.KeyboardEvent<HTMLAnchorElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }
    const current = linkRefs.current.findIndex((el) => el === document.activeElement);
    if (current === -1) {
      return;
    }
    event.preventDefault();
    const next =
      event.key === 'ArrowDown'
        ? Math.min(current + 1, linkRefs.current.length - 1)
        : Math.max(current - 1, 0);
    linkRefs.current[next]?.focus();
  }

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
          {sorted.map((entry, index) => {
            const { urgency, label } = urgencyOf(entry.dueAt, now);
            const { tone, icon } = URGENCY_PRESENTATION[urgency];

            return (
              <tr key={entry.taskId} className="border-b border-divider last:border-b-0">
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  <Link
                    ref={(el) => {
                      linkRefs.current[index] = el;
                    }}
                    href={taskDestination(entry)}
                    onKeyDown={handleKeyDown}
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
