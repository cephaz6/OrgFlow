import { apiGet } from '../../lib/api-server';
import type { NotificationPage } from './types';

export interface FetchNotificationsParams {
  unreadOnly?: boolean | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export async function fetchNotifications(
  params?: FetchNotificationsParams,
): Promise<NotificationPage> {
  const search = new URLSearchParams();
  if (params?.unreadOnly) {
    search.set('unreadOnly', 'true');
  }
  if (params?.cursor) {
    search.set('cursor', params.cursor);
  }
  if (params?.limit) {
    search.set('limit', String(params.limit));
  }
  const queryString = search.toString();

  return apiGet<NotificationPage>(queryString ? `/notifications?${queryString}` : '/notifications');
}
