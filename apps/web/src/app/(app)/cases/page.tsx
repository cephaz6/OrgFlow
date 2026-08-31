import { Button, EmptyState, Pagination } from '@orgflow/ui';
import { ScrollText } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import type { CaseStatus } from '@orgflow/types';

import { CASE_STATUS_OPTIONS, CaseList, fetchMyCases } from '../../../features/cases';
import { fetchCatalogue } from '../../../features/catalogue';
import { HOME_CRUMB, PageHeader } from '../../../features/shell';
import { buildNextHref, buildPrevHref } from '../../../lib/pagination';

export const metadata: Metadata = {
  title: 'My requests: OrgFlow',
};

const BASE_PATH = '/cases';

const CASE_STATUS_VALUES = new Set(CASE_STATUS_OPTIONS.map((entry) => entry.status));

function isCaseStatus(value: string | undefined): value is CaseStatus {
  return value !== undefined && CASE_STATUS_VALUES.has(value as CaseStatus);
}

interface PageProps {
  searchParams: Promise<{
    query?: string;
    cursor?: string;
    history?: string;
    status?: string;
    definitionId?: string;
  }>;
}

export default async function MyCasesPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const { query, cursor, status, definitionId } = resolvedSearchParams;

  // The catalogue supplies process names, which the case list projection
  // does not carry, and doubles as the process filter's own option list.
  // Fetched in parallel rather than in sequence: neither depends on the
  // other, and the page cannot render until both arrive. A large,
  // unpaginated limit: this is an id-to-name lookup, not a browsable list,
  // so it wants effectively everything rather than a first page an
  // organisation with more processes than that would silently truncate.
  const [casePage, cataloguePage] = await Promise.all([
    fetchMyCases({
      query,
      cursor,
      status: isCaseStatus(status) ? status : undefined,
      definitionId,
    }),
    fetchCatalogue({ limit: 200 }),
  ]);

  const processNames = Object.fromEntries(
    cataloguePage.data.map((entry) => [entry.definitionId, entry.name]),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[HOME_CRUMB]}
        title="My requests"
        description="Everything you have submitted, and what is happening to it."
        actions={
          <Button asChild>
            <Link href="/catalogue">Start a request</Link>
          </Button>
        }
      />

      <form method="get" className="flex flex-wrap items-end gap-2" role="search">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="case-search" className="sr-only">
            Search your requests by reference or title
          </label>
          <input
            id="case-search"
            name="query"
            type="search"
            defaultValue={query ?? ''}
            placeholder="Search by reference or title"
            className="h-10 w-64 rounded-md border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="case-status" className="text-xs text-muted-foreground">
            Status
          </label>
          <select
            id="case-status"
            name="status"
            defaultValue={status ?? ''}
            className="h-10 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Any status</option>
            {CASE_STATUS_OPTIONS.map((entry) => (
              <option key={entry.status} value={entry.status}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="case-definition" className="text-xs text-muted-foreground">
            Process
          </label>
          <select
            id="case-definition"
            name="definitionId"
            defaultValue={definitionId ?? ''}
            className="h-10 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Every process</option>
            {cataloguePage.data.map((entry) => (
              <option key={entry.definitionId} value={entry.definitionId}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="h-10 rounded-md border border-input px-4 text-sm hover:bg-accent hover:text-accent-foreground"
        >
          Apply
        </button>
      </form>

      {casePage.data.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={
            query || status || definitionId
              ? 'No requests match this filter'
              : 'You have not submitted anything yet'
          }
          description={
            query || status || definitionId
              ? 'Clear the search, status or process filter to see everything you have submitted.'
              : 'Requests you submit will appear here, with their reference and current status.'
          }
          action={
            query || status || definitionId ? undefined : (
              <Button asChild variant="outline">
                <Link href="/catalogue">Browse the catalogue</Link>
              </Button>
            )
          }
        />
      ) : (
        <CaseList cases={casePage.data} processNames={processNames} />
      )}

      <Pagination
        prevHref={buildPrevHref(BASE_PATH, resolvedSearchParams)}
        nextHref={
          casePage.hasMore && casePage.nextCursor
            ? buildNextHref(BASE_PATH, resolvedSearchParams, casePage.nextCursor)
            : null
        }
      />
    </div>
  );
}
