import {
  buildIdempotencyKey,
  claimNotification,
  findActiveMembersWithRole,
  findCaseById,
  findCaseTaskById,
  findGroupMemberUserIds,
  findProcessDefinitionById,
  findUserById,
  markNotificationFailed,
  markNotificationSent,
  withTenantTransaction,
} from '@orgflow/db';
import type { DomainEvent, Notification } from '@orgflow/types';

import { buildTaskEscalatedEmail, type TaskEscalatedFacts } from './templates.js';
import type { NotificationDeps } from './handle-task-created.js';

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === 'number' ? value : null;
}

// The escalation-level recipient, resolved the same way task.created
// resolves its own: a concrete user, or every active member of a role or
// group pool. Payload-driven for the same reason task.created's is (PRD.md
// §7: resolution occurs at the moment the task is created, and this task is
// no exception).
async function resolveRecipients(
  deps: NotificationDeps,
  organisationId: string,
  payload: Record<string, unknown>,
): Promise<string[]> {
  const assigneeUserId = readString(payload, 'assigneeUserId');
  if (assigneeUserId) {
    return [assigneeUserId];
  }

  const assigneeRole = readString(payload, 'assigneeRole');
  const assigneeGroupId = readString(payload, 'assigneeGroupId');

  if (!assigneeRole && !assigneeGroupId) {
    return [];
  }

  return withTenantTransaction(deps.db, organisationId, async (trx) => {
    if (assigneeRole) {
      const members = await findActiveMembersWithRole(trx, assigneeRole);
      return members.map((member) => member.userId);
    }

    return findGroupMemberUserIds(trx, assigneeGroupId!);
  });
}

async function loadFacts(
  deps: NotificationDeps,
  organisationId: string,
  taskId: string,
): Promise<Omit<TaskEscalatedFacts, 'webUrl' | 'escalationLevel'> | null> {
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

// Handles one task.escalated event. taskId in the payload names the
// original, still-open task (PRD.md §15.3: escalation adds an assignee, it
// never replaces one), which is what supplies the step and due-date facts;
// the recipients come from the escalation resolution the payload carries,
// not from that original task's own assignee.
export async function handleTaskEscalated(
  deps: NotificationDeps,
  event: DomainEvent,
): Promise<{ sent: number; skipped: number }> {
  const organisationId = event.organisationId;
  const taskId = readString(event.payload, 'taskId');
  const caseId = readString(event.payload, 'caseId');
  const escalationLevel = readNumber(event.payload, 'escalationLevel');

  if (!organisationId || !taskId || escalationLevel === null) {
    return { sent: 0, skipped: 0 };
  }

  const [recipients, facts] = await Promise.all([
    resolveRecipients(deps, organisationId, event.payload),
    loadFacts(deps, organisationId, taskId),
  ]);

  if (!facts || recipients.length === 0) {
    return { sent: 0, skipped: 0 };
  }

  const fullFacts: TaskEscalatedFacts = { ...facts, escalationLevel, webUrl: deps.webUrl };

  let sent = 0;
  let skipped = 0;

  for (const recipientUserId of recipients) {
    const claimed = await withTenantTransaction(deps.db, organisationId, (trx) =>
      claimNotification(trx, {
        organisationId,
        recipientUserId,
        caseId,
        taskId,
        channel: 'email',
        templateKey: 'taskEscalated',
        subject: buildTaskEscalatedEmail(fullFacts).subject,
        idempotencyKey: buildIdempotencyKey({
          eventId: event.eventId,
          recipientUserId,
          templateKey: 'taskEscalated',
        }),
      }),
    );

    if (claimed.outcome !== 'claimed') {
      skipped += 1;
      continue;
    }

    await deliver(deps, organisationId, claimed.notification, recipientUserId, fullFacts);
    sent += 1;
  }

  return { sent, skipped };
}

async function deliver(
  deps: NotificationDeps,
  organisationId: string,
  claimed: Notification,
  recipientUserId: string,
  facts: TaskEscalatedFacts,
): Promise<void> {
  const user = await findUserById(deps.db, recipientUserId);
  if (!user) {
    await withTenantTransaction(deps.db, organisationId, (trx) =>
      markNotificationFailed(trx, claimed.notificationId, 'The recipient no longer exists.'),
    );
    return;
  }

  const message = buildTaskEscalatedEmail(facts);

  try {
    await deps.emailSender.send({ ...message, to: user.email });
    await withTenantTransaction(deps.db, organisationId, (trx) =>
      markNotificationSent(trx, claimed.notificationId),
    );
  } catch (err) {
    await withTenantTransaction(deps.db, organisationId, (trx) =>
      markNotificationFailed(trx, claimed.notificationId, String(err)),
    );
    throw err;
  }
}
