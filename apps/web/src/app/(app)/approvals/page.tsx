import { EmptyState } from '@orgflow/ui';
import { Inbox } from 'lucide-react';
import type { Metadata } from 'next';

import { ApprovalQueue, fetchClaimableQueue, fetchMyQueue } from '../../../features/approvals';
import { PageHeader } from '../../../features/shell';

export const metadata: Metadata = {
  title: 'Approvals — OrgFlow',
};

export default async function ApprovalsPage() {
  const [mine, claimable] = await Promise.all([fetchMyQueue(), fetchClaimableQueue()]);

  // Read once and passed down rather than computed per row, so every
  // urgency on the page is measured against the same instant. Rows that
  // disagreed by a few milliseconds could sort inconsistently with what
  // they display.
  const now = new Date();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Approvals" description="Work waiting on you, most urgent first." />

      <section className="flex flex-col gap-4" aria-labelledby="assigned-heading">
        <h2 id="assigned-heading" className="text-lg font-semibold">
          Assigned to you
          <span className="ms-2 font-normal text-muted-foreground">{mine.length}</span>
        </h2>
        {mine.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Nothing is waiting on you"
            description="Approvals assigned to you appear here, with the most urgent at the top."
          />
        ) : (
          <ApprovalQueue entries={mine} now={now} />
        )}
      </section>

      {/* Only shown when there is something to claim. An empty state for a
          pool the user may not belong to would suggest they are missing
          work they were never entitled to. */}
      {claimable.length > 0 ? (
        <section className="flex flex-col gap-4" aria-labelledby="available-heading">
          <h2 id="available-heading" className="text-lg font-semibold">
            Available to claim
            <span className="ms-2 font-normal text-muted-foreground">{claimable.length}</span>
          </h2>
          <ApprovalQueue entries={claimable} now={now} claimable />
        </section>
      ) : null}
    </div>
  );
}
