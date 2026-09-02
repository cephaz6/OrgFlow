import type { Metadata } from 'next';

import { getSession } from '../../../../features/auth';
import { HOME_CRUMB, PageHeader } from '../../../../features/shell';
import { CalendarEditor, fetchWorkingCalendar } from '../../../../features/working-calendar';

export const metadata: Metadata = {
  title: 'Working calendar: OrgFlow',
};

// Readable by any member and editable by admin and above, matching the API.
// A deadline computed from this is shown to everybody, so "why is this due
// Tuesday" is a fair question for whoever holds the task, not only for an
// administrator.
const EDIT_ROLES = new Set(['admin', 'owner']);

export default async function WorkingCalendarPage() {
  const session = await getSession();
  const canEdit = session?.roles.some((role) => EDIT_ROLES.has(role)) ?? false;

  const initial = await fetchWorkingCalendar();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[HOME_CRUMB]}
        title="Working calendar"
        description="When your organisation works. An SLA of 16 hours means 16 working hours, so this decides when every request falls due."
      />

      <CalendarEditor initial={initial} canEdit={canEdit} />
    </div>
  );
}
