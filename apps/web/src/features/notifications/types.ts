// The shape GET /notifications returns (apps/api/src/routes/notifications.ts).
// Always channel 'inApp': an 'email' row is a record that a message
// reached somebody's inbox, not a second copy of the same content meant
// to be read again here.
export interface NotificationEntry {
  notificationId: string;
  caseId: string | null;
  taskId: string | null;
  templateKey: string;
  subject: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  data: NotificationEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}

// The shape GET /notifications/preferences returns: every template this
// user could receive a notification for, with the channels currently
// enabled for it. A template this user has never touched still appears,
// resolved to both channels on (the server's own default), so the settings
// screen never has to invent one itself.
export interface NotificationPreferenceEntry {
  templateKey: string;
  emailEnabled: boolean;
  inAppEnabled: boolean;
}

// Ordered for display, and the single place a friendly label and
// description live for each template key the preferences screen can
// actually control. Kept to exactly the keys the API's own
// PREFERENCE_TEMPLATE_KEYS exposes (apps/api/src/routes/notifications.ts):
// only templates something actually dispatches, never one of PRD.md
// §14.1's not-yet-built ones, which a toggle here could not affect.
export const NOTIFICATION_TEMPLATE_INFO: {
  templateKey: string;
  label: string;
  description: string;
}[] = [
  {
    templateKey: 'taskAssigned',
    label: 'Assigned to me',
    description: 'A task is assigned directly to you.',
  },
  {
    templateKey: 'taskClaimable',
    label: 'Available for my team',
    description: 'A task becomes available for a role or group you belong to.',
  },
  {
    templateKey: 'taskReminder',
    label: 'Reminders',
    description: 'A task assigned to you is still waiting and its due date is approaching.',
  },
  {
    templateKey: 'taskEscalated',
    label: 'Escalated to me',
    description: 'A task has been escalated to you after going unactioned.',
  },
  {
    templateKey: 'caseUnassigned',
    label: 'Needs administrative attention',
    description: 'A case could not be assigned to anyone and needs an administrator.',
  },
  {
    templateKey: 'caseCommented',
    label: 'Comments on my requests',
    description: 'Someone comments on a case you submitted or are handling.',
  },
];
