import { Pagination } from '@orgflow/ui';
import type { Metadata } from 'next';

import { fetchNotifications, NotificationList } from '../../../features/notifications';
import { PageHeader } from '../../../features/shell';
import { buildNextHref, buildPrevHref } from '../../../lib/pagination';

export const metadata: Metadata = {
  title: 'Notifications: OrgFlow',
};

const BASE_PATH = '/notifications';

interface PageProps {
  searchParams: Promise<{ cursor?: string; history?: string }>;
}

export default async function NotificationsPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const { cursor } = resolvedSearchParams;
  const page = await fetchNotifications({ cursor });

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader
        title="Notifications"
        description="What has happened on your requests and tasks."
      />

      <NotificationList notifications={page.data} />

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
