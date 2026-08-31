import { apiGet, apiPatch, apiPost } from '../../lib/api-client';
import type { NotificationPreferenceEntry } from './types';

export async function fetchUnreadNotificationCount(): Promise<number> {
  const { count } = await apiGet<{ count: number }>('/notifications/unread-count');
  return count;
}

export async function updateNotificationPreference(
  templateKey: string,
  input: { emailEnabled: boolean; inAppEnabled: boolean },
): Promise<NotificationPreferenceEntry> {
  return apiPatch<NotificationPreferenceEntry>(
    `/notifications/preferences/${encodeURIComponent(templateKey)}`,
    input,
  );
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await apiPost(`/notifications/${notificationId}/read`);
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiPost('/notifications/read-all');
}
