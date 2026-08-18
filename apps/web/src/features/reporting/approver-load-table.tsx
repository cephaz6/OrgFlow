import type { ApproverLoadEntry } from '@orgflow/types';
import { EmptyState } from '@orgflow/ui';
import { Users } from 'lucide-react';

function formatHours(hours: number): string {
  return hours < 24 ? `${hours.toFixed(1)} hours` : `${(hours / 24).toFixed(1)} days`;
}

export interface ApproverLoadTableProps {
  entries: ApproverLoadEntry[];
}

// Individual-level (PRD.md §17.1/§17.2): only ever rendered when the page
// already knows the viewer is admin/owner and the server already applied
// suppress-below-five, so there is nothing to gate or filter here, only to
// display.
export function ApproverLoadTable({ entries }: ApproverLoadTableProps) {
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Nothing to show yet"
        description="No approver has completed enough tasks in this period to report on. Rows with fewer than five completed tasks are not shown, to avoid identifying anyone from a small sample."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-lg border-collapse text-sm">
        <caption className="sr-only">Approver load, tasks handled and median turnaround</caption>
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th scope="col" className="px-4 py-3 font-medium">
              Approver
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Tasks handled
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Median turnaround
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.approverUserId} className="border-b border-divider last:border-b-0">
              <th scope="row" className="px-4 py-3 text-left font-normal">
                {entry.approverName}
              </th>
              <td className="px-4 py-3">{entry.tasksHandled}</td>
              <td className="px-4 py-3">{formatHours(entry.medianTurnaroundHours)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
