import { apiGet, apiPost } from '../../lib/api-client';

export async function fetchUnreadNotificationCount(): Promise<number> {
  const { count } = await apiGet<{ count: number }>('/notifications/unread-count');
  return count;
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await apiPost(`/notifications/${notificationId}/read`);
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiPost('/notifications/read-all');
}
