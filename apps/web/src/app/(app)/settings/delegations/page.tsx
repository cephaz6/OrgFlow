import { Card, CardContent, CardHeader, CardTitle, Pagination } from '@orgflow/ui';
import type { Metadata } from 'next';

import {
  DelegationForm,
  DelegationList,
  fetchMyDelegations,
} from '../../../../features/delegations';
import { HOME_CRUMB, PageHeader } from '../../../../features/shell';
import { buildNextHref, buildPrevHref } from '../../../../lib/pagination';

export const metadata: Metadata = {
  title: 'Delegations: OrgFlow',
};

const BASE_PATH = '/settings/delegations';

interface PageProps {
  searchParams: Promise<{ query?: string; cursor?: string; history?: string }>;
}

export default async function DelegationsPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const { query, cursor } = resolvedSearchParams;

  const page = await fetchMyDelegations({ query, cursor });

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        breadcrumbs={[HOME_CRUMB, { label: 'Settings', href: '/settings' }]}
        title="Delegations"
        description="Hand your tasks to a colleague while you are away, or see who has delegated to you."
      />

      <Card>
        <CardHeader>
          <CardTitle>Delegate my tasks</CardTitle>
        </CardHeader>
        <CardContent>
          <DelegationForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your delegations</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form method="get" className="flex max-w-md gap-2" role="search">
            <label htmlFor="delegation-search" className="sr-only">
              Search your delegations by colleague name or email
            </label>
            <input
              id="delegation-search"
              name="query"
              type="search"
              defaultValue={query ?? ''}
              placeholder="Search by name or email"
              className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="submit"
              className="h-10 rounded-md border border-input px-4 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              Search
            </button>
          </form>

          <DelegationList delegations={page.data} hasActiveSearch={Boolean(query)} />

          <Pagination
            prevHref={buildPrevHref(BASE_PATH, resolvedSearchParams)}
            nextHref={
              page.hasMore && page.nextCursor
                ? buildNextHref(BASE_PATH, resolvedSearchParams, page.nextCursor)
                : null
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
