import type { Notification, NotificationChannel, NotificationStatus } from '@orgflow/types';
import { sql, type Selectable, type Transaction } from 'kysely';

import type { Database, NotificationsTable } from '../schema.js';
import { generateId } from '../uuid.js';

function toDomain(row: Selectable<NotificationsTable>): Notification {
  return {
    notificationId: row.notification_id,
    organisationId: row.organisation_id,
    recipientUserId: row.recipient_user_id,
    caseId: row.case_id,
    taskId: row.task_id,
    channel: row.channel as NotificationChannel,
    templateKey: row.template_key,
    subject: row.subject,
    status: row.status as NotificationStatus,
    readAt: row.read_at?.toISOString() ?? null,
    sentAt: row.sent_at?.toISOString() ?? null,
    failureReason: row.failure_reason,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at.toISOString(),
  };
}

// PRD.md §14.2 keys delivery on eventId plus recipientUserId plus
// templateKey. Joining them with a separator that cannot appear in a UUID
// or a template key keeps the composite unambiguous in one column, which is
// what lets a UNIQUE constraint enforce it.
export function buildIdempotencyKey(input: {
  eventId: string;
  recipientUserId: string;
  templateKey: string;
}): string {
  return `${input.eventId}|${input.recipientUserId}|${input.templateKey}`;
}

export interface ClaimNotificationInput {
  organisationId: string;
  recipientUserId: string;
  caseId?: string | null;
  taskId?: string | null;
  channel: NotificationChannel;
  templateKey: string;
  subject: string;
  idempotencyKey: string;
}

export type ClaimedNotification =
  // The caller holds the claim and must attempt delivery.
  | { outcome: 'claimed'; notification: Notification }
  // Somebody already delivered this exact notification. Do nothing.
  | { outcome: 'alreadyDelivered'; notification: Notification }
  // Another delivery of the same event is working on it right now. Do
  // nothing; if that attempt fails, the lease below makes it retryable.
  | { outcome: 'inFlight'; notification: Notification };

// How long a claimed-but-undelivered notification is assumed to be in
// somebody else's hands before another delivery may take it over.
//
// This exists because a claim is only as good as the process holding it. A
// worker killed between claiming a row and sending its email leaves the row
// at 'queued' with nobody working on it, and without a lease that
// notification would be skipped by every future redelivery and lost
// silently. Five minutes is comfortably longer than any single send should
// take and short enough that a crash does not strand a notification for
// long.
const CLAIM_LEASE_MINUTES = 5;

// Claims the exclusive right to send one notification, in one of three
// outcomes: this caller holds it, somebody already delivered it, or another
// delivery is working on it now.
//
// Three properties have to hold at once, and each rules out a simpler
// implementation:
//
// 1. Two concurrent redeliveries must not both send. SQS is at-least-once,
//    so "select, then insert if absent" would let both pass the check. The
//    insert is therefore a single INSERT ... ON CONFLICT DO NOTHING, and
//    losing that race is an ordinary result rather than an error.
//
// 2. A send that failed must be retried, not skipped. Treating any
//    conflict as "already handled" would mean one transient email outage
//    lost the notification permanently, since no later redelivery would
//    ever try again.
//
// 3. A retry must not fire while the first attempt is still in flight.
//    This is what a plain "retry anything not yet sent" gets wrong: the
//    first caller has inserted its row but not yet marked it sent, so a
//    concurrent second caller reads 'queued' and sends a duplicate.
//
// The reclaim UPDATE satisfies (2) and (3) together. It matches only a row
// that failed, or one whose claim has outlived the lease, so an in-flight
// attempt is invisible to it while a dead one is not.
export async function claimNotification(
  trx: Transaction<Database>,
  input: ClaimNotificationInput,
): Promise<ClaimedNotification> {
  const inserted = await trx
    .insertInto('notifications')
    .values({
      notification_id: generateId(),
      organisation_id: input.organisationId,
      recipient_user_id: input.recipientUserId,
      case_id: input.caseId ?? null,
      task_id: input.taskId ?? null,
      channel: input.channel,
      template_key: input.templateKey,
      subject: input.subject,
      idempotency_key: input.idempotencyKey,
    })
    .onConflict((oc) => oc.column('idempotency_key').doNothing())
    .returningAll()
    .executeTakeFirst();

  if (inserted) {
    return { outcome: 'claimed', notification: toDomain(inserted) };
  }

  const reclaimed = await trx
    .updateTable('notifications')
    .set({ status: 'queued', failure_reason: null })
    .where('idempotency_key', '=', input.idempotencyKey)
    .where((eb) =>
      eb.or([
        eb('status', '=', 'failed'),
        eb.and([
          eb('status', '=', 'queued'),
          eb('created_at', '<', sql<Date>`now() - make_interval(mins => ${CLAIM_LEASE_MINUTES})`),
        ]),
      ]),
    )
    .returningAll()
    .executeTakeFirst();

  if (reclaimed) {
    return { outcome: 'claimed', notification: toDomain(reclaimed) };
  }

  const existing = await trx
    .selectFrom('notifications')
    .selectAll()
    .where('idempotency_key', '=', input.idempotencyKey)
    .executeTakeFirstOrThrow();

  const notification = toDomain(existing);

  return notification.status === 'sent' || notification.status === 'delivered'
    ? { outcome: 'alreadyDelivered', notification }
    : { outcome: 'inFlight', notification };
}

export async function markNotificationSent(
  trx: Transaction<Database>,
  notificationId: string,
): Promise<void> {
  await trx
    .updateTable('notifications')
    .set({ status: 'sent', sent_at: new Date() })
    .where('notification_id', '=', notificationId)
    .execute();
}

export async function markNotificationFailed(
  trx: Transaction<Database>,
  notificationId: string,
  failureReason: string,
): Promise<void> {
  await trx
    .updateTable('notifications')
    .set({ status: 'failed', failure_reason: failureReason.slice(0, 2000) })
    .where('notification_id', '=', notificationId)
    .execute();
}

export async function findNotificationsForCase(
  trx: Transaction<Database>,
  caseId: string,
): Promise<Notification[]> {
  const rows = await trx
    .selectFrom('notifications')
    .selectAll()
    .where('case_id', '=', caseId)
    .orderBy('created_at', 'asc')
    .execute();

  return rows.map(toDomain);
}

export async function findNotificationsForRecipient(
  trx: Transaction<Database>,
  recipientUserId: string,
): Promise<Notification[]> {
  const rows = await trx
    .selectFrom('notifications')
    .selectAll()
    .where('recipient_user_id', '=', recipientUserId)
    .orderBy('created_at', 'desc')
    .execute();

  return rows.map(toDomain);
}
