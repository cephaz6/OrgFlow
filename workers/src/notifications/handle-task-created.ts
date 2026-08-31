import { createHash, randomBytes } from 'node:crypto';

import {
  buildIdempotencyKey,
  claimNotification,
  createTaskDecisionToken,
  findActiveMembersWithRole,
  findCaseById,
  findCaseTaskById,
  findGroupMemberUserIds,
  findProcessDefinitionById,
  findUserById,
  markNotificationFailed,
  markNotificationSent,
  withTenantTransaction,
  type ClaimedNotification,
  type Database,
} from '@orgflow/db';
import type { DomainEvent, Notification } from '@orgflow/types';
import type { Kysely } from 'kysely';

import type { EmailSender } from '@orgflow/email';
import type { Logger } from '../logger.js';
import { recordInAppNotification } from './in-app.js';
import { resolveNotificationChannels } from './preferences.js';
import {
  buildTaskAssignedEmail,
  buildTaskClaimableEmail,
  type TaskNotificationFacts,
} from './templates.js';

// Deliberately short and independent of the task's own dueAt: a leaked or
// forwarded email should not become a standing way to approve things, and
// a fixed TTL bounds that exposure regardless of how far out the task
// itself is due.
const TASK_DECISION_TOKEN_LIFETIME_MS = 3 * 24 * 60 * 60 * 1000;

export interface NotificationDeps {
  db: Kysely<Database>;
  emailSender: EmailSender;
  webUrl: string;
  logger: Logger;
}

type TemplateKey = 'taskAssigned' | 'taskClaimable';

interface Recipient {
  userId: string;
  templateKey: TemplateKey;
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// PRD.md §14.1 maps task.created to two templates: taskAssigned for the
// resolved assignee, taskClaimable for the eligible members of a role or
// group pool.
//
// Which one applies is read from the **event payload**, not from the task
// row, and that distinction is load-bearing rather than stylistic. The task
// row is mutable: somebody claims a pool task and assignee_user_id stops
// being null. SQS is at-least-once, so a redelivery arriving after that
// claim would re-resolve a group task as taskAssigned, and because the
// template key is part of the idempotency key (PRD.md §14.2), it would
// compute a key nothing had claimed and send a duplicate. The payload
// records how assignment resolved at creation, which is what the event is
// actually about (PRD.md §7: "resolution occurs at task creation"), and it
// never changes, so the key is stable however late the redelivery is.
async function resolveRecipients(
  deps: NotificationDeps,
  organisationId: string,
  payload: Record<string, unknown>,
): Promise<Recipient[]> {
  const assigneeUserId = readString(payload, 'assigneeUserId');
  if (assigneeUserId) {
    return [{ userId: assigneeUserId, templateKey: 'taskAssigned' }];
  }

  const assigneeRole = readString(payload, 'assigneeRole');
  const assigneeGroupId = readString(payload, 'assigneeGroupId');

  if (!assigneeRole && !assigneeGroupId) {
    // An unassigned task with no pool either is PRD.md §7's `unassigned`
    // state, which needs administrative action rather than an email to
    // nobody.
    return [];
  }

  // The membership behind a pool still has to be read live, since the
  // payload names the role or the group but not who is in it.
  return withTenantTransaction(deps.db, organisationId, async (trx) => {
    if (assigneeRole) {
      const members = await findActiveMembersWithRole(trx, assigneeRole);
      return members.map((member) => ({
        userId: member.userId,
        templateKey: 'taskClaimable' as const,
      }));
    }

    const userIds = await findGroupMemberUserIds(trx, assigneeGroupId!);
    return userIds.map((userId) => ({ userId, templateKey: 'taskClaimable' as const }));
  });
}

async function loadFacts(
  deps: NotificationDeps,
  organisationId: string,
  taskId: string,
): Promise<Omit<TaskNotificationFacts, 'webUrl'> | null> {
  return withTenantTransaction(deps.db, organisationId, async (trx) => {
    const task = await findCaseTaskById(trx, taskId);
    if (!task) {
      return null;
    }

    const found = await findCaseById(trx, task.caseId);
    if (!found) {
      return null;
    }

    const definition = await findProcessDefinitionById(trx, found.definitionId);
    const requester = await findUserById(deps.db, found.submittedByUserId);

    return {
      reference: found.reference,
      processName: definition?.name ?? 'Request',
      caseTitle: found.title,
      stepName: task.stepName,
      taskType: task.taskType,
      requesterName: requester?.displayName ?? 'A colleague',
      dueAt: task.dueAt,
      taskId: task.taskId,
    };
  });
}

// Handles one task.created event.
//
// The order of operations is the whole design. The notification row is
// claimed and committed first, then the email is sent, then the row is
// marked sent. Sending inside the transaction would mean a rollback after a
// successful send, so a retry sends a second copy. Claiming after the send
// would mean a crash in between sends the email again on redelivery. This
// way the worst case is a row stuck at 'queued', which is visible and
// recoverable, rather than a duplicate in somebody's inbox.
export async function handleTaskCreated(
  deps: NotificationDeps,
  event: DomainEvent,
): Promise<{ sent: number; skipped: number }> {
  // PRD.md §10 consumer contract: every consumer re-asserts organisationId
  // before touching data. It comes from the envelope, never the payload.
  const organisationId = event.organisationId;
  const taskId = readString(event.payload, 'taskId');
  const caseId = readString(event.payload, 'caseId');

  if (!organisationId || !taskId) {
    deps.logger.warn(
      { eventId: event.eventId, eventType: event.eventType },
      'task.created event carried no organisationId or taskId; ignoring',
    );
    return { sent: 0, skipped: 0 };
  }

  const [recipients, facts] = await Promise.all([
    resolveRecipients(deps, organisationId, event.payload),
    loadFacts(deps, organisationId, taskId),
  ]);

  if (!facts || recipients.length === 0) {
    return { sent: 0, skipped: 0 };
  }

  let sent = 0;
  let skipped = 0;

  for (const recipient of recipients) {
    const channels = await resolveNotificationChannels(
      deps.db,
      organisationId,
      recipient.userId,
      recipient.templateKey,
    );
    if (!channels.email && !channels.inApp) {
      skipped += 1;
      continue;
    }

    let claimed: ClaimedNotification | undefined;
    if (channels.email) {
      claimed = await withTenantTransaction(deps.db, organisationId, (trx) =>
        claimNotification(trx, {
          organisationId,
          recipientUserId: recipient.userId,
          caseId,
          taskId,
          channel: 'email',
          templateKey: recipient.templateKey,
          subject: buildEmail(recipient.templateKey, { ...facts, webUrl: deps.webUrl }).subject,
          idempotencyKey: buildIdempotencyKey({
            eventId: event.eventId,
            recipientUserId: recipient.userId,
            templateKey: recipient.templateKey,
            channel: 'email',
          }),
        }),
      );
    }

    if (channels.inApp) {
      await recordInAppNotification(deps.db, {
        organisationId,
        recipientUserId: recipient.userId,
        caseId,
        taskId,
        eventId: event.eventId,
        templateKey: recipient.templateKey,
        subject: buildEmail(recipient.templateKey, { ...facts, webUrl: deps.webUrl }).subject,
      });
    }

    // This is the idempotency guarantee PRD.md §14.2 requires. Only a
    // 'claimed' outcome sends: 'alreadyDelivered' means a previous
    // redelivery finished the job, and 'inFlight' means another one is
    // doing it right now. A failed attempt becomes claimable again, so an
    // email outage delays a notification rather than losing it. No claim
    // at all (email disabled) counts the same as a claim this handler
    // does not hold: there is nothing here to deliver.
    if (!claimed || claimed.outcome !== 'claimed') {
      skipped += 1;
      continue;
    }

    await deliver(deps, organisationId, claimed.notification, recipient, facts);
    sent += 1;
  }

  return { sent, skipped };
}

async function deliver(
  deps: NotificationDeps,
  organisationId: string,
  claimed: Notification,
  recipient: Recipient,
  facts: Omit<TaskNotificationFacts, 'webUrl'>,
): Promise<void> {
  const user = await findUserById(deps.db, recipient.userId);
  if (!user) {
    await withTenantTransaction(deps.db, organisationId, (trx) =>
      markNotificationFailed(trx, claimed.notificationId, 'The recipient no longer exists.'),
    );
    return;
  }

  // Minted only here, in the branch that actually sends: a redelivery that
  // finds the notification already 'sent'/'delivered' never reaches
  // deliver() at all (the claimNotification outcome check above), so this
  // never mints a second, redundant token for the same send. Only the
  // direct-assignee template carries a one-click approve link; a claimable
  // pool task has no single resolved person to scope the token to.
  let approveToken: string | undefined;
  if (recipient.templateKey === 'taskAssigned') {
    const raw = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(raw).digest('hex');
    await withTenantTransaction(deps.db, organisationId, (trx) =>
      createTaskDecisionToken(trx, {
        organisationId,
        taskId: facts.taskId,
        recipientUserId: recipient.userId,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + TASK_DECISION_TOKEN_LIFETIME_MS),
      }),
    );
    approveToken = raw;
  }

  const message = buildEmail(recipient.templateKey, {
    ...facts,
    webUrl: deps.webUrl,
    ...(approveToken ? { approveToken } : {}),
  });

  try {
    await deps.emailSender.send({ ...message, to: user.email });
    await withTenantTransaction(deps.db, organisationId, (trx) =>
      markNotificationSent(trx, claimed.notificationId),
    );
  } catch (err) {
    // PRD.md §14.2: a notification failure never blocks a workflow
    // transition, and the engine has already committed. The failure is
    // recorded on the row and rethrown so the queue can retry and
    // eventually dead-letter, rather than being swallowed here.
    await withTenantTransaction(deps.db, organisationId, (trx) =>
      markNotificationFailed(trx, claimed.notificationId, String(err)),
    );
    throw err;
  }
}

function buildEmail(templateKey: TemplateKey, facts: TaskNotificationFacts) {
  return templateKey === 'taskAssigned'
    ? buildTaskAssignedEmail(facts)
    : buildTaskClaimableEmail(facts);
}
