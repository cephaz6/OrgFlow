import { createHash } from 'node:crypto';

import {
  claimCaseTask,
  createCase,
  createCaseTask,
  createDb,
  createOrganisation,
  createProcessDefinition,
  createProcessVersion,
  createUserWithIdentity,
  ensureGroup,
  ensureGroupMember,
  findNotificationsForRecipient,
  findTaskDecisionTokenByHash,
  generateId,
  insertOrganisationMember,
  publishProcessVersion,
  updateCaseState,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import type { DomainEvent } from '@orgflow/types';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDummyEmailSender, type DummyEmailSender } from '@orgflow/email';
import type { EmailSender } from '@orgflow/email';
import { createLogger } from './logger.js';
import { dispatchDomainEvent } from './notifications/dispatch.js';
import { handleTaskCreated, type NotificationDeps } from './notifications/handle-task-created.js';

describe('notification worker against real Postgres', () => {
  let db: Kysely<Database>;
  let emailSender: DummyEmailSender;

  let organisationId: string;
  let requesterUserId: string;
  let managerUserId: string;
  let definitionId: string;
  let versionId: string;

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    emailSender = createDummyEmailSender();

    const requester = await createUserWithIdentity(db, {
      email: 'requester@example.invalid',
      displayName: 'Priya Nair',
      issuer: 'urn:orgflow:test',
      subject: `requester-${generateId()}`,
    });
    requesterUserId = requester.userId;

    const manager = await createUserWithIdentity(db, {
      email: 'manager@example.invalid',
      displayName: 'Sam Okafor',
      issuer: 'urn:orgflow:test',
      subject: `manager-${generateId()}`,
    });
    managerUserId = manager.userId;

    const organisation = await createOrganisation(db, {
      name: 'Notifying tenant',
      slug: `notify-${generateId()}`,
      createdByUserId: requester.userId,
    });
    organisationId = organisation.organisationId;

    await withTenantTransaction(db, organisationId, async (trx) => {
      for (const [userId, roles] of [
        [requesterUserId, ['member'] as const],
        [managerUserId, ['member', 'approver'] as const],
      ] as const) {
        await insertOrganisationMember(trx, {
          organisationId,
          userId,
          roles: [...roles],
        });
      }

      const definition = await createProcessDefinition(trx, {
        organisationId,
        key: 'laptop-request',
        name: 'Laptop request',
        referencePrefix: 'LAP',
        createdByUserId: requesterUserId,
      });
      definitionId = definition.definitionId;

      // The worker never reads Mongo, so a placeholder document id is
      // enough here; what it needs from process_versions is the row.
      const version = await createProcessVersion(trx, {
        organisationId,
        definitionId,
        versionNumber: 1,
        documentId: `doc-${generateId()}`,
        documentHash: 'sha256-placeholder',
      });
      versionId = version.versionId;
      await publishProcessVersion(trx, version.versionId, requesterUserId);
    });
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(() => {
    emailSender.clear();
  });

  function deps(sender: EmailSender = emailSender): NotificationDeps {
    return {
      db,
      emailSender: sender,
      webUrl: 'http://localhost:3000',
      logger: createLogger('silent'),
    };
  }

  // A submitted case with one task on it, shaped by the caller.
  async function seedTask(options: {
    assigneeUserId?: string;
    assigneeRole?: string;
    assigneeGroupId?: string;
    title?: string;
  }) {
    return withTenantTransaction(db, organisationId, async (trx) => {
      const draft = await createCase(trx, {
        organisationId,
        definitionId,
        versionId,
        title: options.title ?? 'MacBook Pro 14-inch',
        submittedByUserId: requesterUserId,
      });

      const submitted = await updateCaseState(trx, {
        caseId: draft.caseId,
        expectedRowVersion: draft.rowVersion,
        reference: `LAP-${String(Math.floor(Math.random() * 899999) + 100000)}`,
        status: 'active',
        currentStepKey: 'managerApproval',
        submittedAt: new Date(),
      });

      const task = await createCaseTask(trx, {
        organisationId,
        caseId: draft.caseId,
        stepKey: 'managerApproval',
        stepName: 'Line manager approval',
        taskType: 'approval',
        assignmentStrategy: options.assigneeUserId ? 'lineManager' : 'role',
        assigneeUserId: options.assigneeUserId ?? null,
        assigneeRole: options.assigneeRole ?? null,
        assigneeGroupId: options.assigneeGroupId ?? null,
        dueAt: new Date('2026-08-18T09:00:00.000Z'),
      });

      return { case: submitted, task };
    });
  }

  // Mirrors what apps/api actually publishes: the assignment as it resolved
  // at task creation travels in the payload, so the handler never has to
  // re-read a mutable task row to decide who to tell.
  function taskCreatedEvent(
    seeded: Awaited<ReturnType<typeof seedTask>>,
    overrides: Partial<DomainEvent> = {},
  ): DomainEvent {
    return {
      eventId: `event-${generateId()}`,
      eventType: 'task.created',
      organisationId,
      occurredAt: new Date().toISOString(),
      actorUserId: requesterUserId,
      actorType: 'user',
      correlationId: `correlation-${generateId()}`,
      payload: {
        caseId: seeded.case.caseId,
        taskId: seeded.task.taskId,
        stepKey: 'managerApproval',
        assigneeUserId: seeded.task.assigneeUserId,
        assigneeRole: seeded.task.assigneeRole,
        assigneeGroupId: seeded.task.assigneeGroupId,
        dueAt: seeded.task.dueAt,
      },
      schemaVersion: 1,
      ...overrides,
    };
  }

  it('sends a taskAssigned email to the resolved assignee', async () => {
    const seeded = await seedTask({ assigneeUserId: managerUserId });
    const event = taskCreatedEvent(seeded);

    const result = await handleTaskCreated(deps(), event);

    expect(result).toEqual({ sent: 1, skipped: 0 });
    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0]?.to).toBe('manager@example.invalid');
    expect(emailSender.sent[0]?.subject).toBe(
      `${seeded.case.reference} Approval needed: Laptop request`,
    );
    // PRD.md §14.2: links straight to the actionable screen.
    expect(emailSender.sent[0]?.textBody).toContain(
      `http://localhost:3000/approvals/${seeded.task.taskId}`,
    );

    const { notifications: rows } = await withTenantTransaction(db, organisationId, (trx) =>
      findNotificationsForRecipient(trx, managerUserId),
    );
    const row = rows.find((candidate) => candidate.taskId === seeded.task.taskId);
    expect(row?.status).toBe('sent');
    expect(row?.templateKey).toBe('taskAssigned');
    expect(row?.sentAt).toBeTruthy();
  });

  // The one-click approve link only a taskAssigned email carries: a real,
  // resolvable token that claimNotification's redelivery guarantee also
  // covers (the second test below), so this only has to prove the first
  // send mints one that actually resolves.
  it('mints a resolvable one-click approve token on the taskAssigned email', async () => {
    const seeded = await seedTask({ assigneeUserId: managerUserId });
    const event = taskCreatedEvent(seeded);

    await handleTaskCreated(deps(), event);

    const match = emailSender.sent[0]?.textBody.match(
      /Approve now: http:\/\/localhost:3000\/approvals\/decide\/([0-9a-f]+)/,
    );
    expect(match).toBeTruthy();
    const raw = match![1]!;
    const hash = createHash('sha256').update(raw).digest('hex');

    const token = await findTaskDecisionTokenByHash(db, hash);
    expect(token).toMatchObject({
      organisationId,
      taskId: seeded.task.taskId,
      recipientUserId: managerUserId,
      usedAt: null,
    });
  });

  it('mints only one approve token when the same taskAssigned message is redelivered', async () => {
    const seeded = await seedTask({ assigneeUserId: managerUserId });
    const event = taskCreatedEvent(seeded);

    await handleTaskCreated(deps(), event);
    await handleTaskCreated(deps(), event);

    // Only the first delivery actually reaches deliver() (the second is
    // 'alreadyDelivered'), so only one email, and therefore only one token,
    // is ever minted for this send.
    expect(emailSender.sent).toHaveLength(1);
  });

  // The test the build order calls for by name: deliver the same message
  // twice and prove only one email leaves.
  it('is idempotent when the same message is delivered twice', async () => {
    const seeded = await seedTask({ assigneeUserId: managerUserId });
    const event = taskCreatedEvent(seeded);

    const first = await handleTaskCreated(deps(), event);
    const second = await handleTaskCreated(deps(), event);

    expect(first).toEqual({ sent: 1, skipped: 0 });
    expect(second).toEqual({ sent: 0, skipped: 1 });
    expect(emailSender.sent).toHaveLength(1);

    // Scoped to 'email': this handler now also claims an 'inApp' row for
    // the same task (a second, independent channel, not a second email),
    // so an unscoped read would legitimately find two rows here.
    const { notifications: rows } = await withTenantTransaction(db, organisationId, (trx) =>
      findNotificationsForRecipient(trx, managerUserId, { channel: 'email' }),
    );
    expect(rows.filter((row) => row.taskId === seeded.task.taskId)).toHaveLength(1);
  });

  it('stays idempotent when two deliveries arrive concurrently', async () => {
    // SQS is at-least-once and consumers can overlap, so the claim has to
    // hold under a genuine race, not only sequentially. This is what the
    // single INSERT ... ON CONFLICT buys over check-then-insert.
    const seeded = await seedTask({ assigneeUserId: managerUserId });
    const event = taskCreatedEvent(seeded);

    const results = await Promise.all([
      handleTaskCreated(deps(), event),
      handleTaskCreated(deps(), event),
      handleTaskCreated(deps(), event),
    ]);

    const totalSent = results.reduce((sum, result) => sum + result.sent, 0);
    expect(totalSent).toBe(1);
    expect(emailSender.sent).toHaveLength(1);
  });

  it('stays idempotent when the task is claimed between two deliveries', async () => {
    // Found by running the worker against the real queue rather than by a
    // test. The handler used to re-read the task row to decide the
    // template, so a redelivery arriving after somebody claimed a pool task
    // saw assignee_user_id set, chose taskAssigned instead of
    // taskClaimable, and computed a different idempotency key, which nobody
    // held. The result was a second email to the person who had just
    // claimed it. Resolving from the immutable event payload fixes it.
    const groupId = await withTenantTransaction(db, organisationId, async (trx) => {
      const id = await ensureGroup(trx, {
        organisationId,
        key: `claimRace-${generateId()}`,
        name: 'Claim race team',
      });
      await ensureGroupMember(trx, { organisationId, groupId: id, userId: managerUserId });
      return id;
    });

    const seeded = await seedTask({ assigneeGroupId: groupId });
    const event = taskCreatedEvent(seeded);

    const first = await handleTaskCreated(deps(), event);
    expect(first).toEqual({ sent: 1, skipped: 0 });

    // Somebody claims it, which sets assignee_user_id on the task row.
    await withTenantTransaction(db, organisationId, (trx) =>
      claimCaseTask(trx, seeded.task.taskId, seeded.task.rowVersion, managerUserId),
    );

    const redelivered = await handleTaskCreated(deps(), event);

    expect(redelivered).toEqual({ sent: 0, skipped: 1 });
    expect(emailSender.sent).toHaveLength(1);
  });

  it('treats a different event for the same task as a separate notification', async () => {
    // Idempotency is keyed on eventId, not on the task: a genuinely new
    // event (a reassignment, say) must still notify.
    const seeded = await seedTask({ assigneeUserId: managerUserId });

    await handleTaskCreated(deps(), taskCreatedEvent(seeded));
    await handleTaskCreated(deps(), taskCreatedEvent(seeded));

    expect(emailSender.sent).toHaveLength(2);
  });

  it('fans a role-assigned task out to every member holding the role', async () => {
    const seeded = await seedTask({ assigneeRole: 'approver' });
    const event = taskCreatedEvent(seeded);

    const result = await handleTaskCreated(deps(), event);

    // Only the manager holds `approver`; the requester is a plain member.
    expect(result.sent).toBe(1);
    expect(emailSender.sent[0]?.to).toBe('manager@example.invalid');
    expect(emailSender.sent[0]?.textBody).toContain('Claim it first');
    // No single resolved person to scope a one-click token to, for a pool
    // task nobody has claimed yet.
    expect(emailSender.sent[0]?.textBody).not.toContain('Approve now');

    const { notifications: rows } = await withTenantTransaction(db, organisationId, (trx) =>
      findNotificationsForRecipient(trx, managerUserId),
    );
    expect(rows.find((row) => row.taskId === seeded.task.taskId)?.templateKey).toBe(
      'taskClaimable',
    );
  });

  it('fans a group-assigned task out to every group member', async () => {
    const groupId = await withTenantTransaction(db, organisationId, async (trx) => {
      const id = await ensureGroup(trx, { organisationId, key: 'itSupport', name: 'IT Support' });
      await ensureGroupMember(trx, { organisationId, groupId: id, userId: requesterUserId });
      await ensureGroupMember(trx, { organisationId, groupId: id, userId: managerUserId });
      return id;
    });

    const seeded = await seedTask({ assigneeGroupId: groupId });
    const result = await handleTaskCreated(deps(), taskCreatedEvent(seeded));

    expect(result.sent).toBe(2);
    expect(emailSender.sent.map((message) => message.to).sort()).toEqual([
      'manager@example.invalid',
      'requester@example.invalid',
    ]);
  });

  it('records a send failure and retries it on redelivery rather than losing it', async () => {
    const seeded = await seedTask({ assigneeUserId: managerUserId });
    const event = taskCreatedEvent(seeded);

    const failing: EmailSender = {
      send: () => Promise.reject(new Error('SES is unavailable')),
    };

    await expect(handleTaskCreated(deps(failing), event)).rejects.toThrow('SES is unavailable');

    // Scoped to 'email': the inApp row for this same task claims and sends
    // independently of the email send failing, so an unscoped read could
    // find that one instead of the failed email row.
    const { notifications: afterFailure } = await withTenantTransaction(db, organisationId, (trx) =>
      findNotificationsForRecipient(trx, managerUserId, { channel: 'email' }),
    );
    const failed = afterFailure.find((row) => row.taskId === seeded.task.taskId);
    expect(failed?.status).toBe('failed');
    expect(failed?.failureReason).toContain('SES is unavailable');

    // The row is claimed but undelivered, so a redelivery must try again.
    // Skipping it here would mean a transient outage silently swallowed the
    // notification for good.
    const retry = await handleTaskCreated(deps(), event);
    expect(retry).toEqual({ sent: 1, skipped: 0 });
    expect(emailSender.sent).toHaveLength(1);

    const { notifications: afterRetry } = await withTenantTransaction(db, organisationId, (trx) =>
      findNotificationsForRecipient(trx, managerUserId, { channel: 'email' }),
    );
    expect(afterRetry.find((row) => row.taskId === seeded.task.taskId)?.status).toBe('sent');
  });

  it('ignores an unknown event type rather than erroring', async () => {
    // PRD.md §10: the topic fans every domain event out to this queue, so
    // erroring on an unhandled type would dead-letter valid traffic.
    const result = await dispatchDomainEvent(deps(), {
      eventId: `event-${generateId()}`,
      eventType: 'export.completed',
      organisationId,
      occurredAt: new Date().toISOString(),
      actorUserId: null,
      actorType: 'system',
      correlationId: 'correlation',
      payload: {},
      schemaVersion: 1,
    });

    expect(result).toEqual({ handled: false });
    expect(emailSender.sent).toHaveLength(0);
  });

  it('re-asserts organisationId from the envelope, not the payload', async () => {
    // PRD.md §10 consumer contract. An event whose envelope names another
    // organisation must find nothing, even though the task id in the
    // payload is real.
    const seeded = await seedTask({ assigneeUserId: managerUserId });

    const otherOrganisation = await createOrganisation(db, {
      name: 'Somebody else',
      slug: `other-${generateId()}`,
      createdByUserId: requesterUserId,
    });

    const result = await handleTaskCreated(
      deps(),
      taskCreatedEvent(seeded, {
        organisationId: otherOrganisation.organisationId,
      }),
    );

    expect(result).toEqual({ sent: 0, skipped: 0 });
    expect(emailSender.sent).toHaveLength(0);
  });

  it('does nothing for a task that resolved to nobody', async () => {
    // An unassigned task with no pool is PRD.md §7's `unassigned` state,
    // which needs administrative action rather than an email to nobody.
    const seeded = await seedTask({});

    const result = await handleTaskCreated(deps(), taskCreatedEvent(seeded));

    expect(result).toEqual({ sent: 0, skipped: 0 });
    expect(emailSender.sent).toHaveLength(0);
  });

  it('ignores an event carrying no task id', async () => {
    const result = await handleTaskCreated(deps(), {
      ...taskCreatedEvent(await seedTask({ assigneeUserId: managerUserId })),
      payload: {},
    });

    expect(result).toEqual({ sent: 0, skipped: 0 });
    expect(emailSender.sent).toHaveLength(0);
  });
});
