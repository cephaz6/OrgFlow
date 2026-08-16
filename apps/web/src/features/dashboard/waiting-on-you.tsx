import { StatusBadge } from '@orgflow/ui';
import Link from 'next/link';

import { byUrgency, urgencyOf, type TaskQueueEntry } from '../approvals';
import { taskDestination } from '../approvals/task-destination';
import { URGENCY_PRESENTATION } from '../approvals/urgency-presentation';

export interface WaitingOnYouProps {
  entries: TaskQueueEntry[];
  now: Date;
  // How many to show before deferring to the full queue. The dashboard is a
  // summary, not a second copy of /approvals.
  limit?: number;
}

export function WaitingOnYou({ entries, now, limit = 5 }: WaitingOnYouProps) {
  // Sorted before slicing, not after: taking the first five and then
  // ordering them would show five arbitrary tasks in urgency order rather
  // than the five most urgent, which is the whole point of the section.
  const sorted = byUrgency(entries);
  const shown = sorted.slice(0, limit);

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col">
        {shown.map((entry) => {
          const { urgency, label } = urgencyOf(entry.dueAt, now);
          const { tone, icon } = URGENCY_PRESENTATION[urgency];

          return (
            <li key={entry.taskId} className="border-b border-divider last:border-b-0">
              <Link
                href={taskDestination(entry)}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 transition-colors hover:bg-accent"
              >
                <span className="font-mono text-sm text-link">{entry.caseReference}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{entry.stepName}</span>
                <span className="truncate text-sm text-muted-foreground">
                  {entry.requesterName}
                </span>
                <StatusBadge tone={tone} icon={icon} label={label} />
              </Link>
            </li>
          );
        })}
      </ul>

      {sorted.length > shown.length ? (
        <Link
          href="/approvals"
          className="border-t border-divider px-5 py-3 text-sm text-link hover:text-link-hover"
        >
          View all {sorted.length} approvals
        </Link>
      ) : null}
    </div>
  );
}
