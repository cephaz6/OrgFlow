import { Button, EmptyState, Pagination } from '@orgflow/ui';
import { FilePlus2, ShieldOff } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { getSession } from '../../../features/auth';
import { fetchManagedDefinitions, ManageList } from '../../../features/form-builder';
import { fetchGroups } from '../../../features/groups';
import { HOME_CRUMB, PageHeader } from '../../../features/shell';
import { buildNextHref, buildPrevHref } from '../../../lib/pagination';

export const metadata: Metadata = {
  title: 'Processes: OrgFlow',
};

const MANAGE_ROLES = new Set(['processOwner', 'admin', 'owner']);
const BASE_PATH = '/processes';

interface PageProps {
  searchParams: Promise<{ query?: string; cursor?: string; history?: string }>;
}

export default async function ProcessesPage({ searchParams }: PageProps) {
  // getSession() cannot return null here: the (app) layout already redirects
  // when there is no session, and this is what tells the compiler that.
  const session = await getSession();
  const canManage = session?.roles.some((role) => MANAGE_ROLES.has(role)) ?? false;

  if (!canManage) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader breadcrumbs={[HOME_CRUMB]} title="Processes" />
        <EmptyState
          icon={ShieldOff}
          title="Process owner access required"
          description="Building or editing a process needs the process owner, admin or owner role. Ask an administrator to grant it if you need to set up a new process."
        />
      </div>
    );
  }

  const resolvedSearchParams = await searchParams;
  const { query, cursor } = resolvedSearchParams;

  const [page, groups] = await Promise.all([
    fetchManagedDefinitions({ query, cursor }),
    fetchGroups(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[HOME_CRUMB]}
        title="Processes"
        description="The forms and workflows you own, at every stage from draft to published."
        actions={
          <Button asChild>
            <Link href="/processes/new">
              <FilePlus2 aria-hidden="true" className="h-4 w-4" />
              New process
            </Link>
          </Button>
        }
      />

      <form method="get" className="flex max-w-md gap-2" role="search">
        <label htmlFor="process-search" className="sr-only">
          Search processes by name
        </label>
        <input
          id="process-search"
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

      <ManageList definitions={page.data} groups={groups} />

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
