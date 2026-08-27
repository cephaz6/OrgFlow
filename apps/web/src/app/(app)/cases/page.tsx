import { Button, EmptyState, Pagination } from '@orgflow/ui';
import { ScrollText } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { CaseList, fetchMyCases } from '../../../features/cases';
import { fetchCatalogue } from '../../../features/catalogue';
import { PageHeader } from '../../../features/shell';
import { buildNextHref, buildPrevHref } from '../../../lib/pagination';

export const metadata: Metadata = {
  title: 'My requests: OrgFlow',
};

const BASE_PATH = '/cases';

interface PageProps {
  searchParams: Promise<{ query?: string; cursor?: string; history?: string }>;
}

export default async function MyCasesPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const { query, cursor } = resolvedSearchParams;

  // The catalogue supplies process names, which the case list projection
  // does not carry. Fetched in parallel rather than in sequence: neither
  // depends on the other, and the page cannot render until both arrive. A
  // large, unpaginated limit: this is an id-to-name lookup, not a browsable
  // list, so it wants effectively everything rather than a first page an
  // organisation with more processes than that would silently truncate.
  const [casePage, cataloguePage] = await Promise.all([
    fetchMyCases({ query, cursor }),
    fetchCatalogue({ limit: 200 }),
  ]);

  const processNames = Object.fromEntries(
    cataloguePage.data.map((entry) => [entry.definitionId, entry.name]),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My requests"
        description="Everything you have submitted, and what is happening to it."
        actions={
          <Button asChild>
            <Link href="/catalogue">Start a request</Link>
          </Button>
        }
      />

      <form method="get" className="flex max-w-md gap-2" role="search">
        <label htmlFor="case-search" className="sr-only">
          Search your requests by reference or title
        </label>
        <input
          id="case-search"
          name="query"
          type="search"
          defaultValue={query ?? ''}
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

      {casePage.data.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={query ? 'No requests match this search' : 'You have not submitted anything yet'}
          description={
            query
              ? 'Clear the search to see everything you have submitted.'
              : 'Requests you submit will appear here, with their reference and current status.'
          }
          action={
            query ? undefined : (
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
