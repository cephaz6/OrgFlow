import {
  buildIdempotencyKey,
  claimNotification,
  markNotificationSent,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import type { Kysely } from 'kysely';

export interface RecordInAppNotificationInput {
  organisationId: string;
  recipientUserId: string;
  caseId?: string | null;
  taskId?: string | null;
  eventId: string;
  templateKey: string;
  subject: string;
}

// The in-app half of every notification handler's delivery, alongside its
// existing email send. Claims and immediately marks sent in one step:
// unlike email, there is no external delivery step for an in-app
// notification, since the row's own existence is the delivery. Still goes
// through claimNotification rather than a bare insert, so a redelivery of
// the same event does not create a second row for the same recipient and
// template (PRD.md §14.2's idempotency guarantee, which this channel needs
// exactly as much as email does).
export async function recordInAppNotification(
  db: Kysely<Database>,
  input: RecordInAppNotificationInput,
): Promise<void> {
  await withTenantTransaction(db, input.organisationId, async (trx) => {
    const claimed = await claimNotification(trx, {
      organisationId: input.organisationId,
      recipientUserId: input.recipientUserId,
      caseId: input.caseId ?? null,
      taskId: input.taskId ?? null,
      channel: 'inApp',
      templateKey: input.templateKey,
      subject: input.subject,
      idempotencyKey: buildIdempotencyKey({
        eventId: input.eventId,
        recipientUserId: input.recipientUserId,
        templateKey: input.templateKey,
        channel: 'inApp',
      }),
    });

    if (claimed.outcome === 'claimed') {
      await markNotificationSent(trx, claimed.notification.notificationId);
    }
  });
}
