import {
  buildIdempotencyKey,
  claimNotification,
  findCaseById,
  findCaseTaskById,
  findProcessDefinitionById,
  findUserById,
  markNotificationFailed,
  markNotificationSent,
  withTenantTransaction,
  type ClaimedNotification,
} from '@orgflow/db';
import type { DomainEvent, Notification } from '@orgflow/types';

import { recordInAppNotification } from './in-app.js';
import { resolveNotificationChannels } from './preferences.js';
import { buildTaskReminderEmail, type TaskNotificationFacts } from './templates.js';
import type { NotificationDeps } from './handle-task-created.js';

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
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

// PRD.md §15.2's reminder timer: purely informational, so this never touches
// case state. Only the assignee already holding the task is reminded; a
// pool task nobody has claimed yet has no single recipient to remind and is
// left to taskClaimable, which was already sent when the task was created.
export async function handleTaskReminderDue(
  deps: NotificationDeps,
  event: DomainEvent,
): Promise<{ sent: number; skipped: number }> {
  const organisationId = event.organisationId;
  const taskId = readString(event.payload, 'taskId');
  const caseId = readString(event.payload, 'caseId');
  const assigneeUserId = readString(event.payload, 'assigneeUserId');

  if (!organisationId || !taskId || !assigneeUserId) {
    return { sent: 0, skipped: 0 };
  }

  const facts = await loadFacts(deps, organisationId, taskId);
  if (!facts) {
    return { sent: 0, skipped: 0 };
  }

  const channels = await resolveNotificationChannels(
    deps.db,
    organisationId,
    assigneeUserId,
    'taskReminder',
  );
  if (!channels.email && !channels.inApp) {
    return { sent: 0, skipped: 1 };
  }

  let claimed: ClaimedNotification | undefined;
  if (channels.email) {
    claimed = await withTenantTransaction(deps.db, organisationId, (trx) =>
      claimNotification(trx, {
        organisationId,
        recipientUserId: assigneeUserId,
        caseId,
        taskId,
        channel: 'email',
        templateKey: 'taskReminder',
        subject: buildTaskReminderEmail({ ...facts, webUrl: deps.webUrl }).subject,
        idempotencyKey: buildIdempotencyKey({
          eventId: event.eventId,
          recipientUserId: assigneeUserId,
          templateKey: 'taskReminder',
          channel: 'email',
        }),
      }),
    );
  }

  if (channels.inApp) {
    await recordInAppNotification(deps.db, {
      organisationId,
      recipientUserId: assigneeUserId,
      caseId,
      taskId,
      eventId: event.eventId,
      templateKey: 'taskReminder',
      subject: buildTaskReminderEmail({ ...facts, webUrl: deps.webUrl }).subject,
    });
  }

  if (!claimed || claimed.outcome !== 'claimed') {
    return { sent: 0, skipped: 1 };
  }

  await deliver(deps, organisationId, claimed.notification, assigneeUserId, facts);
  return { sent: 1, skipped: 0 };
}

async function deliver(
  deps: NotificationDeps,
  organisationId: string,
  claimed: Notification,
  recipientUserId: string,
  facts: Omit<TaskNotificationFacts, 'webUrl'>,
): Promise<void> {
  const user = await findUserById(deps.db, recipientUserId);
  if (!user) {
    await withTenantTransaction(deps.db, organisationId, (trx) =>
      markNotificationFailed(trx, claimed.notificationId, 'The recipient no longer exists.'),
    );
    return;
  }

  const message = buildTaskReminderEmail({ ...facts, webUrl: deps.webUrl });

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
