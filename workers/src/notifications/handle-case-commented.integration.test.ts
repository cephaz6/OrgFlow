import {
  createCase,
  createCaseComment,
  createCaseTask,
  createDb,
  createOrganisation,
  createProcessDefinition,
  createProcessVersion,
  createUserWithIdentity,
  findNotificationsForRecipient,
  findUserById,
  generateId,
  insertOrganisationMember,
  publishProcessVersion,
  updateCaseState,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import { createDummyEmailSender, type DummyEmailSender } from '@orgflow/email';
import type { CommentVisibility, DomainEvent } from '@orgflow/types';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createLogger } from '../logger.js';
import { handleCaseCommented } from './handle-case-commented.js';
import type { NotificationDeps } from './handle-task-created.js';

describe('the case.commented notification handler against real Postgres', () => {
  let db: Kysely<Database>;
  let emailSender: DummyEmailSender;
  let organisationId: string;
  let requesterUserId: string;
  let assigneeUserId: string;
  let definitionId: string;
  let versionId: string;

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });

    const requester = await createUserWithIdentity(db, {
      email: `commented-requester-${generateId()}@example.invalid`,
      displayName: 'Commented Requester',
      issuer: 'urn:orgflow:test',
      subject: `commented-requester-${generateId()}`,
    });
    requesterUserId = requester.userId;

    const assignee = await createUserWithIdentity(db, {
      email: `commented-assignee-${generateId()}@example.invalid`,
      displayName: 'Commented Assignee',
      issuer: 'urn:orgflow:test',
      subject: `commented-assignee-${generateId()}`,
    });
    assigneeUserId = assignee.userId;

    const organisation = await createOrganisation(db, {
      name: 'Commented notification tenant',
      slug: `commented-${generateId()}`,
      createdByUserId: requesterUserId,
    });
    organisationId = organisation.organisationId;

    await withTenantTransaction(db, organisationId, async (trx) => {
      await insertOrganisationMember(trx, {
        organisationId,
        userId: requesterUserId,
        roles: ['member'],
      });
      await insertOrganisationMember(trx, {
        organisationId,
        userId: assigneeUserId,
        roles: ['member', 'approver'],
      });

      const definition = await createProcessDefinition(trx, {
        organisationId,
        key: 'commented-test-process',
        name: 'Commented test process',
        referencePrefix: 'CMD',
        createdByUserId: requesterUserId,
      });
      definitionId = definition.definitionId;

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
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(() => {
    emailSender = createDummyEmailSender();
  });

  function deps(): NotificationDeps {
    return { db, emailSender, webUrl: 'http://localhost:3000', logger: createLogger('silent') };
  }

  async function seedCaseWithTask() {
    return withTenantTransaction(db, organisationId, async (trx) => {
      const draft = await createCase(trx, {
        organisationId,
        definitionId,
        versionId,
        title: 'A commented test case',
        submittedByUserId: requesterUserId,
      });
      const submitted = await updateCaseState(trx, {
        caseId: draft.caseId,
        expectedRowVersion: draft.rowVersion,
        reference: `CMD-${generateId()}`,
        status: 'active',
        currentStepKey: 'approval',
        submittedAt: new Date(),
      });
      const task = await createCaseTask(trx, {
        organisationId,
        caseId: draft.caseId,
        stepKey: 'approval',
        stepName: 'Approval',
        taskType: 'approval',
        assignmentStrategy: 'lineManager',
        assigneeUserId,
      });
      return { case: submitted, task };
    });
  }

  async function postComment(
    caseId: string,
    authorUserId: string,
    body: string,
    visibility: CommentVisibility = 'all',
  ) {
    return withTenantTransaction(db, organisationId, (trx) =>
      createCaseComment(trx, { organisationId, caseId, authorUserId, body, visibility }),
    );
  }

  function commentedEvent(caseId: string, commentId: string): DomainEvent {
    return {
      eventId: `event-${generateId()}`,
      eventType: 'case.commented',
      organisationId,
      occurredAt: new Date().toISOString(),
      actorUserId: requesterUserId,
      actorType: 'user',
      correlationId: `correlation-${generateId()}`,
      payload: { caseId, commentId },
      schemaVersion: 1,
    };
  }

  it('notifies the assignee when the requester comments', async () => {
    const seeded = await seedCaseWithTask();
    const comment = await postComment(seeded.case.caseId, requesterUserId, 'Any update on this?');

    const result = await handleCaseCommented(
      deps(),
      commentedEvent(seeded.case.caseId, comment.commentId),
    );

    expect(result).toEqual({ sent: 1, skipped: 0 });
    expect(emailSender.sent).toHaveLength(1);
    const assignee = await findUserById(db, assigneeUserId);
    expect(emailSender.sent[0]?.to).toBe(assignee!.email);
    expect(emailSender.sent[0]?.textBody).toContain('Any update on this?');
  });

  it('notifies the requester when the assignee comments, but not the author themselves', async () => {
    const seeded = await seedCaseWithTask();
    const comment = await postComment(
      seeded.case.caseId,
      assigneeUserId,
      'Could you confirm the budget code?',
    );

    const result = await handleCaseCommented(
      deps(),
      commentedEvent(seeded.case.caseId, comment.commentId),
    );

    expect(result).toEqual({ sent: 1, skipped: 0 });
    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0]?.textBody).toContain('Could you confirm the budget code?');

    const { notifications } = await withTenantTransaction(db, organisationId, (trx) =>
      findNotificationsForRecipient(trx, requesterUserId, { channel: 'email' }),
    );
    expect(notifications.some((n) => n.caseId === seeded.case.caseId)).toBe(true);
  });

  it('does not notify the requester about an internal, approvers-only comment', async () => {
    const seeded = await seedCaseWithTask();
    const comment = await postComment(
      seeded.case.caseId,
      assigneeUserId,
      'Internal note, not for the requester.',
      'approvers',
    );

    const result = await handleCaseCommented(
      deps(),
      commentedEvent(seeded.case.caseId, comment.commentId),
    );

    // The only other party on this case is the requester, and an
    // 'approvers'-visibility comment is never visible to them, so there is
    // nobody left to notify.
    expect(result).toEqual({ sent: 0, skipped: 0 });
    expect(emailSender.sent).toHaveLength(0);
  });

  it('is idempotent when the same comment event is delivered twice', async () => {
    const seeded = await seedCaseWithTask();
    const comment = await postComment(seeded.case.caseId, requesterUserId, 'Redelivered comment.');
    const event = commentedEvent(seeded.case.caseId, comment.commentId);

    const first = await handleCaseCommented(deps(), event);
    const second = await handleCaseCommented(deps(), event);

    expect(first).toEqual({ sent: 1, skipped: 0 });
    expect(second).toEqual({ sent: 0, skipped: 1 });
    expect(emailSender.sent).toHaveLength(1);
  });

  it('ignores an event naming a comment that no longer exists', async () => {
    const seeded = await seedCaseWithTask();

    const result = await handleCaseCommented(
      deps(),
      commentedEvent(seeded.case.caseId, generateId()),
    );

    expect(result).toEqual({ sent: 0, skipped: 0 });
  });
});
