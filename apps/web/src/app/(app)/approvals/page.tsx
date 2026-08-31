import { EmptyState, Pagination } from '@orgflow/ui';
import { Inbox } from 'lucide-react';
import type { Metadata } from 'next';

import { ApprovalQueue, fetchClaimableQueue, fetchMyQueue } from '../../../features/approvals';
import { fetchCatalogue } from '../../../features/catalogue';
import { HOME_CRUMB, PageHeader } from '../../../features/shell';
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
    mineDefinitionId?: string;
    mineOverdue?: string;
    mineStatus?: string;
    claimQuery?: string;
    claimCursor?: string;
    claimHistory?: string;
    claimDefinitionId?: string;
    claimOverdue?: string;
  }>;
}

export default async function ApprovalsPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const {
    mineQuery,
    mineCursor,
    mineDefinitionId,
    mineOverdue,
    mineStatus,
    claimQuery,
    claimCursor,
    claimDefinitionId,
    claimOverdue,
  } = resolvedSearchParams;

  // One shared list for both sections' process filters: the catalogue is
  // every published definition, which is exactly the set a task's own
  // definitionId can ever belong to.
  const [mine, claimable, catalogue] = await Promise.all([
    fetchMyQueue({
      query: mineQuery,
      cursor: mineCursor,
      definitionId: mineDefinitionId,
      overdue: mineOverdue === 'true',
      status: mineStatus === 'pending' || mineStatus === 'claimed' ? mineStatus : undefined,
    }),
    fetchClaimableQueue({
      query: claimQuery,
      cursor: claimCursor,
      definitionId: claimDefinitionId,
      overdue: claimOverdue === 'true',
    }),
    fetchCatalogue({ limit: 200 }),
  ]);

  // Read once and passed down rather than computed per row, so every
  // urgency on the page is measured against the same instant. Rows that
  // disagreed by a few milliseconds could sort inconsistently with what
  // they display.
  const now = new Date();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        breadcrumbs={[HOME_CRUMB]}
        title="Approvals"
        description="Work waiting on you, most urgent first."
      />

      <section className="flex flex-col gap-4" aria-labelledby="assigned-heading">
        <h2 id="assigned-heading" className="text-lg font-semibold">
          Assigned to you
          <span className="ms-2 font-normal text-muted-foreground">{mine.data.length}</span>
        </h2>

        <form
          method="get"
          className="flex flex-wrap items-end gap-2"
          role="search"
          aria-label="Filter work assigned to you"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mine-search" className="sr-only">
              Search work assigned to you by reference or title
            </label>
            <input
              id="mine-search"
              name="mineQuery"
              type="search"
              defaultValue={mineQuery ?? ''}
              placeholder="Search by reference or title"
              className="h-10 w-64 rounded-md border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="mine-definition" className="text-xs text-muted-foreground">
              Process
            </label>
            <select
              id="mine-definition"
              name="mineDefinitionId"
              defaultValue={mineDefinitionId ?? ''}
              className="h-10 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Every process</option>
              {catalogue.data.map((entry) => (
                <option key={entry.definitionId} value={entry.definitionId}>
                  {entry.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="mine-status" className="text-xs text-muted-foreground">
              Status
            </label>
            <select
              id="mine-status"
              name="mineStatus"
              defaultValue={mineStatus ?? ''}
              className="h-10 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Assigned or claimed</option>
              <option value="pending">Assigned, not yet claimed</option>
              <option value="claimed">Claimed by you</option>
            </select>
          </div>

          <label htmlFor="mine-overdue" className="flex h-10 items-center gap-2 text-sm">
            <input
              id="mine-overdue"
              name="mineOverdue"
              type="checkbox"
              value="true"
              defaultChecked={mineOverdue === 'true'}
              className="h-4 w-4 accent-primary"
            />
            Overdue only
          </label>

          <button
            type="submit"
            className="h-10 rounded-md border border-input px-4 text-sm hover:bg-accent hover:text-accent-foreground"
          >
            Apply
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

      {/* Only shown when there is something to claim, or a filter is active
          (so clearing a filter that returned nothing is possible). An empty
          state for a pool the user may not belong to at all would suggest
          they are missing work they were never entitled to. */}
      {claimable.data.length > 0 || claimQuery || claimDefinitionId || claimOverdue === 'true' ? (
        <section className="flex flex-col gap-4" aria-labelledby="available-heading">
          <h2 id="available-heading" className="text-lg font-semibold">
            Available to claim
            <span className="ms-2 font-normal text-muted-foreground">{claimable.data.length}</span>
          </h2>

          <form
            method="get"
            className="flex flex-wrap items-end gap-2"
            role="search"
            aria-label="Filter work available to claim"
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor="claim-search" className="sr-only">
                Search available work by reference or title
              </label>
              <input
                id="claim-search"
                name="claimQuery"
                type="search"
                defaultValue={claimQuery ?? ''}
                placeholder="Search by reference or title"
                className="h-10 w-64 rounded-md border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="claim-definition" className="text-xs text-muted-foreground">
                Process
              </label>
              <select
                id="claim-definition"
                name="claimDefinitionId"
                defaultValue={claimDefinitionId ?? ''}
                className="h-10 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Every process</option>
                {catalogue.data.map((entry) => (
                  <option key={entry.definitionId} value={entry.definitionId}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </div>

            <label htmlFor="claim-overdue" className="flex h-10 items-center gap-2 text-sm">
              <input
                id="claim-overdue"
                name="claimOverdue"
                type="checkbox"
                value="true"
                defaultChecked={claimOverdue === 'true'}
                className="h-4 w-4 accent-primary"
              />
              Overdue only
            </label>

            <button
              type="submit"
              className="h-10 rounded-md border border-input px-4 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              Apply
            </button>
          </form>

          {claimable.data.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No matches for this filter"
              description="Clear the search, process or overdue filter to see everything available to claim."
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
