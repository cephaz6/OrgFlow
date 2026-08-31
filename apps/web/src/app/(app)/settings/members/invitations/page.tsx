import { EmptyState, Pagination } from '@orgflow/ui';
import { ShieldOff } from 'lucide-react';
import type { Metadata } from 'next';

import { fetchInvitations, PendingInvitationsList } from '../../../../../features/invitations';
import { HOME_CRUMB, PageHeader, SectionTabs } from '../../../../../features/shell';
import { buildNextHref, buildPrevHref } from '../../../../../lib/pagination';

export const metadata: Metadata = {
  title: 'Invitations: OrgFlow',
};

const TABS = [
  { href: '/settings/members/invite', label: 'Invite a member' },
  { href: '/settings/members/invitations', label: 'Invitations' },
  { href: '/settings/members/directory', label: 'Active members' },
];

const BASE_PATH = '/settings/members/invitations';

interface PageProps {
  searchParams: Promise<{ query?: string; cursor?: string; history?: string }>;
}

export default async function InvitationsPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const { query, cursor } = resolvedSearchParams;

  const page = await fetchInvitations({ query, cursor });

  if (page === null) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          breadcrumbs={[HOME_CRUMB, { label: 'Members', href: '/settings/members' }]}
          title="Invitations"
        />
        <EmptyState
          icon={ShieldOff}
          title="Admin access required"
          description="Managing invitations needs the admin or owner role. Ask an administrator to grant it if you need to see this."
        />
      </div>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <SectionTabs label="Members sections" items={TABS} />

      <PageHeader
        breadcrumbs={[HOME_CRUMB, { label: 'Members', href: '/settings/members' }]}
        title="Invitations"
        description="Every invitation sent from this organisation, and its current status."
      />

      <form method="get" className="flex max-w-md gap-2" role="search">
        <label htmlFor="invitation-search" className="sr-only">
          Search invitations by email
        </label>
        <input
          id="invitation-search"
          name="query"
          type="search"
          defaultValue={query ?? ''}
          placeholder="Search by email"
          className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="submit"
          className="h-10 rounded-md border border-input px-4 text-sm hover:bg-accent hover:text-accent-foreground"
        >
          Search
        </button>
      </form>

      {/* Not wrapped in a Card: the list already renders its own bordered
          surface (matching how MemberList is used unwrapped on the
          directory page), and a Card around it produced a border nested
          inside a border rather than one clean edge. */}
      <PendingInvitationsList invitations={page.invitations} />

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
