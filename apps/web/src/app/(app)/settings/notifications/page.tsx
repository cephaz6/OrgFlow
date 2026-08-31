import { Card, CardContent, CardHeader, CardTitle } from '@orgflow/ui';
import type { Metadata } from 'next';

import {
  fetchNotificationPreferences,
  NotificationPreferences,
} from '../../../../features/notifications';
import { HOME_CRUMB, PageHeader } from '../../../../features/shell';

export const metadata: Metadata = {
  title: 'Notifications: OrgFlow',
};

// Self-service, gated only by having a session: unlike members or groups,
// this is entirely about the caller's own inbox, so there is nothing here
// an admin role would need to authorise.
export default async function NotificationPreferencesPage() {
  const preferences = await fetchNotificationPreferences();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        breadcrumbs={[HOME_CRUMB, { label: 'Settings', href: '/settings' }]}
        title="Notifications"
        description="Which notifications reach you, and by email, in-app, or both."
      />

      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
        </CardHeader>
        <CardContent>
          <NotificationPreferences preferences={preferences} />
        </CardContent>
      </Card>
    </div>
  );
}
