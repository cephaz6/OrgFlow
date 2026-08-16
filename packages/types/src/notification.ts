import type { IsoDateTimeString, Uuid } from './common.js';

export type NotificationChannel = 'email' | 'inApp';

export type NotificationStatus = 'queued' | 'sent' | 'delivered' | 'failed' | 'suppressed';

// PRD.md §14.1. Only the templates something actually sends are listed;
// the remainder arrive with the phases that trigger them, so an unhandled
// key is a compile error rather than a silently unsent message.
export type NotificationTemplateKey =
  | 'caseSubmitted'
  | 'taskAssigned'
  | 'taskClaimable'
  | 'taskReminder'
  | 'taskEscalated'
  | 'caseReturned'
  | 'caseCompleted'
  | 'caseRejected'
  | 'caseUnassigned'
  | 'delegationStarted';

export interface Notification {
  notificationId: Uuid;
  organisationId: Uuid;
  recipientUserId: Uuid;
  caseId: Uuid | null;
  taskId: Uuid | null;
  channel: NotificationChannel;
  templateKey: string;
  subject: string | null;
  status: NotificationStatus;
  readAt: IsoDateTimeString | null;
  sentAt: IsoDateTimeString | null;
  failureReason: string | null;
  // PRD.md §14.2: eventId plus recipientUserId plus templateKey.
  idempotencyKey: string;
  createdAt: IsoDateTimeString;
}
