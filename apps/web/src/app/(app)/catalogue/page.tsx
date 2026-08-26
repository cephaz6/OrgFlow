import { EmptyState, Pagination } from '@orgflow/ui';
import { LibraryBig } from 'lucide-react';
import type { Metadata } from 'next';

import { CatalogueGrid, fetchCatalogue } from '../../../features/catalogue';
import { PageHeader } from '../../../features/shell';
import { buildNextHref, buildPrevHref } from '../../../lib/pagination';

export const metadata: Metadata = {
  title: 'Catalogue: OrgFlow',
};

const BASE_PATH = '/catalogue';

interface PageProps {
  searchParams: Promise<{ query?: string; cursor?: string; history?: string }>;
}

export default async function CataloguePage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const { query, cursor } = resolvedSearchParams;

  const page = await fetchCatalogue({ query, cursor });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Catalogue"
        description="The processes your organisation has published. Choose one to start a request."
      />

      <form method="get" className="flex max-w-md gap-2" role="search">
        <label htmlFor="catalogue-search" className="sr-only">
          Search the catalogue by name
        </label>
        <input
          id="catalogue-search"
          name="query"
          type="search"
          defaultValue={query ?? ''}
          placeholder="Search by name"
          className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="submit"
          className="h-10 rounded-md border border-input px-4 text-sm hover:bg-accent hover:text-accent-foreground"
        >
          Search
        </button>
      </form>

      {page.data.length === 0 ? (
        <EmptyState
          icon={LibraryBig}
          title={query ? 'No processes match this search' : 'No processes published yet'}
          description={
            query
              ? 'Clear the search to see everything published so far.'
              : 'A process owner needs to build and publish a process before anyone can start a request. Nothing is available to you until then.'
          }
        />
      ) : (
        <CatalogueGrid entries={page.data} />
      )}

      <Pagination
        prevHref={buildPrevHref(BASE_PATH, resolvedSearchParams)}
        nextHref={
          page.hasMore && page.nextCursor
            ? buildNextHref(BASE_PATH, resolvedSearchParams, page.nextCursor)
            : null
        }
      />
    </div>
  );
}
