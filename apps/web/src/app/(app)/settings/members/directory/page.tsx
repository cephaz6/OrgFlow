import { EmptyState, Pagination } from '@orgflow/ui';
import { ShieldOff } from 'lucide-react';
import type { Metadata } from 'next';

import { getSession } from '../../../../../features/auth';
import { fetchMembers, MemberList } from '../../../../../features/members';
import { PageHeader, SectionTabs } from '../../../../../features/shell';
import { buildNextHref, buildPrevHref } from '../../../../../lib/pagination';

export const metadata: Metadata = {
  title: 'Active members: OrgFlow',
};

const TABS = [
  { href: '/settings/members/invite', label: 'Invite a member' },
  { href: '/settings/members/invitations', label: 'Invitations' },
  { href: '/settings/members/directory', label: 'Active members' },
];

const BASE_PATH = '/settings/members/directory';

interface PageProps {
  searchParams: Promise<{ query?: string; cursor?: string; history?: string }>;
}

export default async function MemberDirectoryPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const { query, cursor } = resolvedSearchParams;
  const session = await getSession();

  // The API is the authority (PRD.md §12.3), so this asks it rather than
  // deciding from the session's roles claim, which ADR-0010 leaves up to
  // twelve hours stale. A null answer is its 403.
  const page = await fetchMembers({ query, cursor });

  if (page === null) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Active members" />
        <EmptyState
          icon={ShieldOff}
          title="Admin access required"
          description="Managing members needs the admin or owner role. Ask an administrator to grant it if you need to see this."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionTabs label="Members sections" items={TABS} />

      <PageHeader
        title="Active members"
        description="Everyone in this organisation, the roles they hold, and who they report to."
      />

      <form method="get" className="flex max-w-md gap-2" role="search">
        <label htmlFor="member-search" className="sr-only">
          Search members by name or email
        </label>
        <input
          id="member-search"
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

      {/* getSession() cannot be null here: the (app) layout redirects when
          there is no session, and this is what tells the compiler so. */}
      <MemberList members={page.members} currentUserId={session!.user.userId} />

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
