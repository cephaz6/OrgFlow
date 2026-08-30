'use client';

import { Alert, Button, EmptyState } from '@orgflow/ui';
import { Bell, Check } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { formatDateTime } from '../../lib/format';
import { markAllNotificationsRead, markNotificationRead } from './api-client';
import type { NotificationEntry } from './types';

export interface NotificationListProps {
  notifications: NotificationEntry[];
}

// Where a notification actually leads: a task-shaped template links to the
// approval screen the task lives on, everything else with a case falls
// back to the case itself, and a notification naming neither is not a
// link, just text.
function hrefFor(notification: NotificationEntry): string | null {
  if (notification.taskId) {
    return `/approvals/${notification.taskId}`;
  }
  if (notification.caseId) {
    return `/cases/${notification.caseId}`;
  }
  return null;
}

export function NotificationList({ notifications }: NotificationListProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (notifications.length === 0) {
    return (
      <EmptyState
        icon={Bell}
        title="No notifications"
        description="Nothing yet. Notifications appear here as your requests and tasks move."
      />
    );
  }

  async function readOne(notificationId: string) {
    setBusy(notificationId);
    setError(null);
    try {
      await markNotificationRead(notificationId);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That could not be marked as read.');
    } finally {
      setBusy(null);
    }
  }

  async function readAll() {
    setBusy('all');
    setError(null);
    try {
      await markAllNotificationsRead();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Notifications could not be marked as read.');
    } finally {
      setBusy(null);
    }
  }

  const hasUnread = notifications.some((notification) => !notification.readAt);

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert variant="destructive">{error}</Alert> : null}

      {hasUnread ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-end"
          disabled={busy === 'all'}
          onClick={() => void readAll()}
        >
          <Check aria-hidden="true" className="h-4 w-4" />
          Mark all as read
        </Button>
      ) : null}

      <ol className="flex flex-col gap-2">
        {notifications.map((notification) => {
          const href = hrefFor(notification);
          const unread = !notification.readAt;
          const content = (
            <span className="flex flex-1 flex-col gap-0.5">
              <span className={unread ? 'text-sm font-medium' : 'text-sm text-muted-foreground'}>
                {notification.subject ?? 'Notification'}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDateTime(notification.createdAt)}
              </span>
            </span>
          );

          return (
            <li
              key={notification.notificationId}
              className={`flex items-center gap-3 rounded-lg border p-3 ${
                unread ? 'border-primary/30 bg-accent/40' : 'border-border'
              }`}
            >
              {unread ? (
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-primary" />
              ) : (
                <span className="h-2 w-2 shrink-0" />
              )}

              {href ? (
                <Link href={href} className="flex flex-1 items-center gap-3">
                  {content}
                </Link>
              ) : (
                content
              )}

              {unread ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy === notification.notificationId}
                  onClick={() => void readOne(notification.notificationId)}
                >
                  Mark as read
                  <span className="sr-only"> {notification.subject}</span>
                </Button>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
