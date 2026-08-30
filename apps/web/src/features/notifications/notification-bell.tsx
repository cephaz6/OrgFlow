'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { fetchUnreadNotificationCount } from './api-client';

// Fetched once on mount, not polled: a badge that is briefly stale until
// the next navigation is a reasonable trade against an interval timer
// running in every open tab for as long as the app is open. Visiting
// /notifications itself always shows the true, current state regardless.
export function NotificationBell() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchUnreadNotificationCount()
      .then((value) => {
        if (!cancelled) {
          setCount(value);
        }
      })
      .catch(() => {
        // A failed count fetch is not worth surfacing as an error: the
        // bell just shows no badge, and /notifications itself still works.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasUnread = typeof count === 'number' && count > 0;

  return (
    <Link
      href="/notifications"
      aria-label={hasUnread ? `Notifications, ${count} unread` : 'Notifications'}
      className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-accent"
    >
      <Bell aria-hidden="true" className="h-4.5 w-4.5" />
      {hasUnread ? (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium leading-none text-destructive-foreground"
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  );
}
