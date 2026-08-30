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
