import { EmptyState, Pagination } from '@orgflow/ui';
import { Inbox } from 'lucide-react';
import type { Metadata } from 'next';

import { ApprovalQueue, fetchClaimableQueue, fetchMyQueue } from '../../../features/approvals';
import { PageHeader } from '../../../features/shell';
import { buildNextHref, buildPrevHref } from '../../../lib/pagination';

export const metadata: Metadata = {
  title: 'Approvals: OrgFlow',
};

const BASE_PATH = '/approvals';

interface PageProps {
  searchParams: Promise<{
    mineQuery?: string;
    mineCursor?: string;
    mineHistory?: string;
    claimQuery?: string;
    claimCursor?: string;
    claimHistory?: string;
  }>;
}

export default async function ApprovalsPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const { mineQuery, mineCursor, claimQuery, claimCursor } = resolvedSearchParams;

  const [mine, claimable] = await Promise.all([
    fetchMyQueue({ query: mineQuery, cursor: mineCursor }),
    fetchClaimableQueue({ query: claimQuery, cursor: claimCursor }),
  ]);

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
          <span className="ms-2 font-normal text-muted-foreground">{mine.data.length}</span>
        </h2>

        <form method="get" className="flex max-w-md gap-2" role="search">
          <label htmlFor="mine-search" className="sr-only">
            Search work assigned to you by reference or title
          </label>
          <input
            id="mine-search"
            name="mineQuery"
            type="search"
            defaultValue={mineQuery ?? ''}
            placeholder="Search by reference or title"
            className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="submit"
            className="h-10 rounded-md border border-input px-4 text-sm hover:bg-accent hover:text-accent-foreground"
          >
            Search
          </button>
        </form>

        {mine.data.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={mineQuery ? 'No matches for this search' : 'Nothing is waiting on you'}
            description={
              mineQuery
                ? 'Clear the search to see everything assigned to you.'
                : 'Approvals assigned to you appear here, with the most urgent at the top.'
            }
          />
        ) : (
          <ApprovalQueue entries={mine.data} now={now} />
        )}

        <Pagination
          prevHref={buildPrevHref(BASE_PATH, resolvedSearchParams, 'mine')}
          nextHref={
            mine.hasMore && mine.nextCursor
              ? buildNextHref(BASE_PATH, resolvedSearchParams, mine.nextCursor, 'mine')
              : null
          }
        />
      </section>

      {/* Only shown when there is something to claim, or a search is active
          (so clearing a search that returned nothing is possible). An empty
          state for a pool the user may not belong to at all would suggest
          they are missing work they were never entitled to. */}
      {claimable.data.length > 0 || claimQuery ? (
        <section className="flex flex-col gap-4" aria-labelledby="available-heading">
          <h2 id="available-heading" className="text-lg font-semibold">
            Available to claim
            <span className="ms-2 font-normal text-muted-foreground">{claimable.data.length}</span>
          </h2>

          <form method="get" className="flex max-w-md gap-2" role="search">
            <label htmlFor="claim-search" className="sr-only">
              Search available work by reference or title
            </label>
            <input
              id="claim-search"
              name="claimQuery"
              type="search"
              defaultValue={claimQuery ?? ''}
              placeholder="Search by reference or title"
              className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="submit"
              className="h-10 rounded-md border border-input px-4 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              Search
            </button>
          </form>

          {claimable.data.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No matches for this search"
              description="Clear the search to see everything available to claim."
            />
          ) : (
            <ApprovalQueue entries={claimable.data} now={now} claimable />
          )}

          <Pagination
            prevHref={buildPrevHref(BASE_PATH, resolvedSearchParams, 'claim')}
            nextHref={
              claimable.hasMore && claimable.nextCursor
                ? buildNextHref(BASE_PATH, resolvedSearchParams, claimable.nextCursor, 'claim')
                : null
            }
          />
        </section>
      ) : null}
    </div>
  );
}
