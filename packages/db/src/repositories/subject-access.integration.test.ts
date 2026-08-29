import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb } from '../connection.js';
import { appendAuditEvent, findAllAuditEventsForActor } from './audit-events.js';
import { createAttachment, findAllAttachmentsUploadedByUser } from './attachments.js';
import { createCaseTask, findAllCaseTasksForUser } from './case-tasks.js';
import { createCase, findAllCasesSubmittedByUser, updateCaseState } from './cases.js';
import {
  createProcessDefinition,
  createProcessVersion,
  publishProcessVersion,
} from './process-definitions.js';
import { createOrganisation } from './organisations.js';
import { createUserWithIdentity } from './users.js';
import type { Database } from '../schema.js';
import { withTenantTransaction } from '../tenant-transaction.js';
import { generateId } from '../uuid.js';

// The read side of PRD.md §18's subject access export. Exercises the four
// unpaginated "find everything this user is named on" functions together,
// and proves the one property that matters most for an export: a subject
// in one organisation never pulls in a same-named subject's rows from
// another.
describe('subject access export queries, tenant-scoped', () => {
  let db: Kysely<Database>;
  let organisationId: string;
  let otherOrganisationId: string;
  let subjectUserId: string;
  let otherSubjectUserId: string;
  let caseId: string;
  let taskId: string;

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });

    const subject = await createUserWithIdentity(db, {
      email: `sar-subject-${generateId()}@example.invalid`,
      displayName: 'SAR Subject',
      issuer: 'urn:orgflow:test',
      subject: `sar-subject-${generateId()}`,
    });
    subjectUserId = subject.userId;

    const organisation = await createOrganisation(db, {
      name: 'SAR test tenant',
      slug: `sar-test-${generateId()}`,
      createdByUserId: subject.userId,
    });
    organisationId = organisation.organisationId;

    const otherSubject = await createUserWithIdentity(db, {
      email: `sar-other-subject-${generateId()}@example.invalid`,
      displayName: 'SAR Other Subject',
      issuer: 'urn:orgflow:test',
      subject: `sar-other-subject-${generateId()}`,
    });
    otherSubjectUserId = otherSubject.userId;

    const otherOrganisation = await createOrganisation(db, {
      name: 'SAR other tenant',
      slug: `sar-other-test-${generateId()}`,
      createdByUserId: otherSubject.userId,
    });
    otherOrganisationId = otherOrganisation.organisationId;

    await withTenantTransaction(db, organisationId, async (trx) => {
      const definition = await createProcessDefinition(trx, {
        organisationId,
        key: 'sar-test-process',
        name: 'SAR test process',
        referencePrefix: 'SAR',
        createdByUserId: subjectUserId,
      });
      const version = await createProcessVersion(trx, {
        organisationId,
        definitionId: definition.definitionId,
        versionNumber: 1,
        documentId: `doc-${generateId()}`,
        documentHash: 'sha256-placeholder',
      });
      await publishProcessVersion(trx, version.versionId, subjectUserId);

      const draft = await createCase(trx, {
        organisationId,
        definitionId: definition.definitionId,
        versionId: version.versionId,
        title: 'A SAR test case',
        submittedByUserId: subjectUserId,
      });
      const submitted = await updateCaseState(trx, {
        caseId: draft.caseId,
        expectedRowVersion: draft.rowVersion,
        reference: `SAR-${generateId()}`,
        submittedAt: new Date(),
      });
      caseId = submitted.caseId;

      const task = await createCaseTask(trx, {
        organisationId,
        caseId,
        stepKey: 'approve',
        stepName: 'Approve',
        taskType: 'approval',
        assignmentStrategy: 'user',
        assigneeUserId: subjectUserId,
      });
      taskId = task.taskId;

      await createAttachment(trx, {
        attachmentId: generateId(),
        organisationId,
        caseId,
        fieldKey: 'quote',
        filename: 'quote.pdf',
        declaredMimeType: 'application/pdf',
        sizeBytes: 1024,
        storageKey: `${organisationId}/cases/${caseId}/quote.pdf`,
        uploadedByUserId: subjectUserId,
      });

      await appendAuditEvent(trx, {
        organisationId,
        actorUserId: subjectUserId,
        entityType: 'case',
        entityId: caseId,
        action: 'case.submitted',
      });
    });
  });

  afterAll(async () => {
    // Every tenant table's organisation_id FK is ON DELETE CASCADE, so
    // removing the two organisations is sufficient to remove everything
    // seeded under them (cases, tasks, attachments, audit events, the
    // process definition and version); only the users, created outside
    // any organisation, need a separate delete.
    await db
      .deleteFrom('organisations')
      .where('organisation_id', 'in', [organisationId, otherOrganisationId])
      .execute();
    await db
      .deleteFrom('users')
      .where('user_id', 'in', [subjectUserId, otherSubjectUserId])
      .execute();
    await db.destroy();
  });

  it('finds every case the subject submitted, and none from another tenant', async () => {
    const cases = await withTenantTransaction(db, organisationId, (trx) =>
      findAllCasesSubmittedByUser(trx, subjectUserId),
    );
    expect(cases.map((c) => c.caseId)).toEqual([caseId]);

    const otherTenantView = await withTenantTransaction(db, otherOrganisationId, (trx) =>
      findAllCasesSubmittedByUser(trx, subjectUserId),
    );
    expect(otherTenantView).toEqual([]);
  });

  it('finds every task the subject was assigned, and none from another tenant', async () => {
    const tasks = await withTenantTransaction(db, organisationId, (trx) =>
      findAllCaseTasksForUser(trx, subjectUserId),
    );
    expect(tasks.map((t) => t.taskId)).toEqual([taskId]);

    const otherTenantView = await withTenantTransaction(db, otherOrganisationId, (trx) =>
      findAllCaseTasksForUser(trx, subjectUserId),
    );
    expect(otherTenantView).toEqual([]);
  });

  it('finds every audit event naming the subject as actor, and none from another tenant', async () => {
    const events = await withTenantTransaction(db, organisationId, (trx) =>
      findAllAuditEventsForActor(trx, subjectUserId),
    );
    expect(events.map((e) => e.action)).toContain('case.submitted');

    const otherTenantView = await withTenantTransaction(db, otherOrganisationId, (trx) =>
      findAllAuditEventsForActor(trx, subjectUserId),
    );
    expect(otherTenantView).toEqual([]);
  });

  it('finds every attachment the subject uploaded, and none from another tenant', async () => {
    const attachments = await withTenantTransaction(db, organisationId, (trx) =>
      findAllAttachmentsUploadedByUser(trx, subjectUserId),
    );
    expect(attachments.map((a) => a.filename)).toEqual(['quote.pdf']);

    const otherTenantView = await withTenantTransaction(db, otherOrganisationId, (trx) =>
      findAllAttachmentsUploadedByUser(trx, subjectUserId),
    );
    expect(otherTenantView).toEqual([]);
  });

  it('never confuses two subjects with the same id shape across tenants', async () => {
    const cases = await withTenantTransaction(db, organisationId, (trx) =>
      findAllCasesSubmittedByUser(trx, otherSubjectUserId),
    );
    expect(cases).toEqual([]);
  });
});
