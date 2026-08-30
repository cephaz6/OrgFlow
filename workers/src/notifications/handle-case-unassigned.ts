import {
  buildIdempotencyKey,
  claimNotification,
  findActiveMembersWithRole,
  findCaseById,
  findProcessDefinitionById,
  findUserById,
  markNotificationFailed,
  markNotificationSent,
  withTenantTransaction,
} from '@orgflow/db';
import type { DomainEvent, Notification } from '@orgflow/types';

import { recordInAppNotification } from './in-app.js';
import { buildCaseUnassignedEmail, type CaseUnassignedFacts } from './templates.js';
import type { NotificationDeps } from './handle-task-created.js';

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// PRD.md §7: unassigned is explicit and visible, requiring administrative
// action. case.unassigned fires from every path that leads there (no
// eligible assignee at all, a self-approval guard nobody could resolve, or
// escalation exhausting every configured level), so this notifies every
// active administrator each time, rather than only on one of those paths.
export async function handleCaseUnassigned(
  deps: NotificationDeps,
  event: DomainEvent,
): Promise<{ sent: number; skipped: number }> {
  const organisationId = event.organisationId;
  const caseId = readString(event.payload, 'caseId');

  if (!organisationId || !caseId) {
    return { sent: 0, skipped: 0 };
  }

  const [admins, facts] = await Promise.all([
    withTenantTransaction(deps.db, organisationId, (trx) =>
      findActiveMembersWithRole(trx, 'admin'),
    ),
    withTenantTransaction(deps.db, organisationId, async (trx) => {
      const found = await findCaseById(trx, caseId);
      if (!found) {
        return null;
      }
      const definition = await findProcessDefinitionById(trx, found.definitionId);
      return {
        reference: found.reference,
        processName: definition?.name ?? 'Request',
        caseTitle: found.title,
        caseId: found.caseId,
        reason: 'No eligible assignee could be resolved for the next step.',
      };
    }),
  ]);

  if (!facts || admins.length === 0) {
    return { sent: 0, skipped: 0 };
  }

  const fullFacts: CaseUnassignedFacts = { ...facts, webUrl: deps.webUrl };

  let sent = 0;
  let skipped = 0;

  for (const admin of admins) {
    const claimed = await withTenantTransaction(deps.db, organisationId, (trx) =>
      claimNotification(trx, {
        organisationId,
        recipientUserId: admin.userId,
        caseId,
        taskId: null,
        channel: 'email',
        templateKey: 'caseUnassigned',
        subject: buildCaseUnassignedEmail(fullFacts).subject,
        idempotencyKey: buildIdempotencyKey({
          eventId: event.eventId,
          recipientUserId: admin.userId,
          templateKey: 'caseUnassigned',
          channel: 'email',
        }),
      }),
    );

    await recordInAppNotification(deps.db, {
      organisationId,
      recipientUserId: admin.userId,
      caseId,
      eventId: event.eventId,
      templateKey: 'caseUnassigned',
      subject: buildCaseUnassignedEmail(fullFacts).subject,
    });

    if (claimed.outcome !== 'claimed') {
      skipped += 1;
      continue;
    }

    await deliver(deps, organisationId, claimed.notification, admin.userId, fullFacts);
    sent += 1;
  }

  return { sent, skipped };
}

async function deliver(
  deps: NotificationDeps,
  organisationId: string,
  claimed: Notification,
  recipientUserId: string,
  facts: CaseUnassignedFacts,
): Promise<void> {
  const user = await findUserById(deps.db, recipientUserId);
  if (!user) {
    await withTenantTransaction(deps.db, organisationId, (trx) =>
      markNotificationFailed(trx, claimed.notificationId, 'The recipient no longer exists.'),
    );
    return;
  }

  const message = buildCaseUnassignedEmail(facts);

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
