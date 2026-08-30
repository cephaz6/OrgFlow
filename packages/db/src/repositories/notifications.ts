import type { Notification, NotificationChannel, NotificationStatus } from '@orgflow/types';
import { sql, type Selectable, type Transaction } from 'kysely';

import { clampPageSize } from '../pagination.js';
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
// templateKey. Widened here to also carry channel: the same event, for the
// same recipient and template, now claims two rows (an 'email' one and an
// 'inApp' one, see workers/src/notifications/in-app.ts), and without
// channel in the key both would compute the same string and the second
// insert would collide on the table's UNIQUE constraint, read as "already
// delivered" rather than claiming its own row. Joining with a separator
// that cannot appear in a UUID, a template key or 'email'/'inApp' keeps the
// composite unambiguous in one column, which is what lets a UNIQUE
// constraint enforce it.
export function buildIdempotencyKey(input: {
  eventId: string;
  recipientUserId: string;
  templateKey: string;
  channel: NotificationChannel;
}): string {
  return `${input.eventId}|${input.recipientUserId}|${input.templateKey}|${input.channel}`;
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

export interface FindNotificationsForRecipientFilter {
  // No default: an unscoped call still returns every channel, exactly the
  // general-purpose "this recipient's own notification bookkeeping" read
  // the existing worker tests already rely on (checking the 'email' row
  // a send left behind). The notification centre route passes
  // channel: 'inApp' explicitly, since an 'email' row there is a record
  // that a message reached somebody's inbox, not a second copy of the
  // same content meant to be read again in the product.
  channel?: NotificationChannel | undefined;
  unreadOnly?: boolean | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface NotificationPage {
  notifications: Notification[];
  nextCursor: string | null;
  hasMore: boolean;
}

// idx_notifications_recipient_unread (the notifications migration) is
// exactly this query's unread-inApp-by-recipient shape, and had sat unused
// until the notification centre existed to use it.
export async function findNotificationsForRecipient(
  trx: Transaction<Database>,
  recipientUserId: string,
  filter: FindNotificationsForRecipientFilter = {},
): Promise<NotificationPage> {
  const limit = clampPageSize(filter.limit);

  let query = trx
    .selectFrom('notifications')
    .selectAll()
    .where('recipient_user_id', '=', recipientUserId);

  if (filter.channel) {
    query = query.where('channel', '=', filter.channel);
  }
  if (filter.unreadOnly) {
    query = query.where('read_at', 'is', null);
  }
  if (filter.cursor) {
    query = query.where('notification_id', '<', filter.cursor);
  }

  const rows = await query
    .orderBy('notification_id', 'desc')
    .limit(limit + 1)
    .execute();

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    notifications: page.map(toDomain),
    nextCursor: hasMore ? (page[page.length - 1]?.notification_id ?? null) : null,
    hasMore,
  };
}

// The nav bell's badge count: a dedicated COUNT rather than paging through
// findNotificationsForRecipient at a large limit, and served by the same
// partial index.
export async function countUnreadNotifications(
  trx: Transaction<Database>,
  recipientUserId: string,
): Promise<number> {
  const result = await trx
    .selectFrom('notifications')
    .select(({ fn }) => fn.countAll<string>().as('count'))
    .where('recipient_user_id', '=', recipientUserId)
    .where('channel', '=', 'inApp')
    .where('read_at', 'is', null)
    .executeTakeFirstOrThrow();

  return Number(result.count);
}

// Scoped to recipientUserId in the WHERE clause, not just looked up by id:
// this is called from a route with only the caller's own session to trust,
// and the extra clause is what stops one person marking read a
// notification addressed to somebody else, even if they guessed its id.
export async function markNotificationRead(
  trx: Transaction<Database>,
  notificationId: string,
  recipientUserId: string,
): Promise<void> {
  await trx
    .updateTable('notifications')
    .set({ read_at: new Date() })
    .where('notification_id', '=', notificationId)
    .where('recipient_user_id', '=', recipientUserId)
    .execute();
}

export async function markAllNotificationsRead(
  trx: Transaction<Database>,
  recipientUserId: string,
): Promise<void> {
  await trx
    .updateTable('notifications')
    .set({ read_at: new Date() })
    .where('recipient_user_id', '=', recipientUserId)
    .where('channel', '=', 'inApp')
    .where('read_at', 'is', null)
    .execute();
}
