import {
  buildIdempotencyKey,
  claimNotification,
  findCaseById,
  findCaseCommentById,
  findCaseTasksForCase,
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
import { buildCaseCommentedEmail, type CaseCommentedFacts } from './templates.js';
import type { NotificationDeps } from './handle-task-created.js';

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// Everyone this comment is actually for, besides its own author: the
// submitter, only if the comment is visible to them at all ('all', never
// 'approvers', the same rule case-comments.ts reads by), plus whoever
// individually holds an open task on the case right now. A role- or
// group-assigned open task has no single person to name here (nobody has
// claimed it yet), so it is left out rather than guessed at; the same
// scope boundary task.created's own recipient resolution draws for pool
// tasks, just not repeated here since a comment is not itself an
// assignment event.
async function resolveRecipients(
  deps: NotificationDeps,
  organisationId: string,
  caseId: string,
  authorUserId: string,
  visibleToSubmitter: boolean,
  submitterUserId: string,
): Promise<string[]> {
  const recipients = new Set<string>();

  if (visibleToSubmitter && submitterUserId !== authorUserId) {
    recipients.add(submitterUserId);
  }

  const tasks = await withTenantTransaction(deps.db, organisationId, (trx) =>
    findCaseTasksForCase(trx, caseId),
  );
  for (const task of tasks) {
    if (
      (task.status === 'pending' || task.status === 'claimed') &&
      task.assigneeUserId &&
      task.assigneeUserId !== authorUserId
    ) {
      recipients.add(task.assigneeUserId);
    }
  }

  return [...recipients];
}

export async function handleCaseCommented(
  deps: NotificationDeps,
  event: DomainEvent,
): Promise<{ sent: number; skipped: number }> {
  const organisationId = event.organisationId;
  const caseId = readString(event.payload, 'caseId');
  const commentId = readString(event.payload, 'commentId');

  if (!organisationId || !caseId || !commentId) {
    return { sent: 0, skipped: 0 };
  }

  const [comment, caseFacts] = await withTenantTransaction(deps.db, organisationId, async (trx) => {
    const foundComment = await findCaseCommentById(trx, commentId);
    const found = await findCaseById(trx, caseId);
    if (!found) {
      return [foundComment, null] as const;
    }
    const definition = await findProcessDefinitionById(trx, found.definitionId);
    return [
      foundComment,
      {
        reference: found.reference,
        processName: definition?.name ?? 'Request',
        caseTitle: found.title,
        caseId: found.caseId,
        submittedByUserId: found.submittedByUserId,
      },
    ] as const;
  });

  if (!comment || !caseFacts) {
    return { sent: 0, skipped: 0 };
  }

  const author = await findUserById(deps.db, comment.authorUserId);
  const recipients = await resolveRecipients(
    deps,
    organisationId,
    caseId,
    comment.authorUserId,
    comment.visibility === 'all',
    caseFacts.submittedByUserId,
  );

  if (recipients.length === 0) {
    return { sent: 0, skipped: 0 };
  }

  const fullFacts: CaseCommentedFacts = {
    reference: caseFacts.reference,
    processName: caseFacts.processName,
    caseTitle: caseFacts.caseTitle,
    caseId: caseFacts.caseId,
    authorName: author?.displayName ?? 'Someone',
    commentBody: comment.body,
    webUrl: deps.webUrl,
  };

  let sent = 0;
  let skipped = 0;

  for (const recipientUserId of recipients) {
    const channels = await resolveNotificationChannels(
      deps.db,
      organisationId,
      recipientUserId,
      'caseCommented',
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
          recipientUserId,
          caseId,
          taskId: null,
          channel: 'email',
          templateKey: 'caseCommented',
          subject: buildCaseCommentedEmail(fullFacts).subject,
          idempotencyKey: buildIdempotencyKey({
            eventId: event.eventId,
            recipientUserId,
            templateKey: 'caseCommented',
            channel: 'email',
          }),
        }),
      );
    }

    if (channels.inApp) {
      await recordInAppNotification(deps.db, {
        organisationId,
        recipientUserId,
        caseId,
        eventId: event.eventId,
        templateKey: 'caseCommented',
        subject: buildCaseCommentedEmail(fullFacts).subject,
      });
    }

    if (!claimed || claimed.outcome !== 'claimed') {
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
  facts: CaseCommentedFacts,
): Promise<void> {
  const user = await findUserById(deps.db, recipientUserId);
  if (!user) {
    await withTenantTransaction(deps.db, organisationId, (trx) =>
      markNotificationFailed(trx, claimed.notificationId, 'The recipient no longer exists.'),
    );
    return;
  }

  const message = buildCaseCommentedEmail(facts);

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
