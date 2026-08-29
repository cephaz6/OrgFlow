import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb } from '../connection.js';
import { createAttachment, redactAttachment } from './attachments.js';
import {
  createCase,
  findCasesEligibleForRedaction,
  markCaseRedacted,
  updateCaseState,
} from './cases.js';
import {
  createProcessDefinition,
  createProcessVersion,
  publishProcessVersion,
  updateProcessDefinitionMetadata,
} from './process-definitions.js';
import { createOrganisation } from './organisations.js';
import { createUserWithIdentity } from './users.js';
import type { Database } from '../schema.js';
import { withTenantTransaction } from '../tenant-transaction.js';
import { generateId } from '../uuid.js';

// The retention window is a real elapsed-time comparison
// (completed_at + retention_days <= now), so this exercises it against
// actual backdated timestamps rather than mocking the clock: a case
// "completed 10 days ago" is created by writing that date directly, the
// same way sla-and-delegations.integration.test.ts backdates a timer's
// fire_at to prove overdue detection without waiting for real time to pass.
describe('retention: findCasesEligibleForRedaction, tenant-crossing by design', () => {
  let db: Kysely<Database>;
  let organisationId: string;
  let userId: string;
  let definitionWithRetentionId: string;
  let definitionNoRetentionId: string;
  let versionId: string;

  async function createCompletedCase(definitionId: string, completedAt: Date) {
    return withTenantTransaction(db, organisationId, async (trx) => {
      const draft = await createCase(trx, {
        organisationId,
        definitionId,
        versionId,
        title: 'A retention test case',
        submittedByUserId: userId,
      });
      return updateCaseState(trx, {
        caseId: draft.caseId,
        expectedRowVersion: draft.rowVersion,
        reference: `RET-${generateId()}`,
        status: 'completed',
        submittedAt: completedAt,
        completedAt,
      });
    });
  }

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });

    const user = await createUserWithIdentity(db, {
      email: `retention-${generateId()}@example.invalid`,
      displayName: 'Retention test user',
      issuer: 'urn:orgflow:test',
      subject: `retention-${generateId()}`,
    });
    userId = user.userId;

    const organisation = await createOrganisation(db, {
      name: 'Retention test tenant',
      slug: `retention-${generateId()}`,
      createdByUserId: userId,
    });
    organisationId = organisation.organisationId;

    await withTenantTransaction(db, organisationId, async (trx) => {
      const withRetention = await createProcessDefinition(trx, {
        organisationId,
        key: 'retention-with-window',
        name: 'Has a retention window',
        referencePrefix: 'RETW',
        retentionDays: 7,
        createdByUserId: userId,
      });
      definitionWithRetentionId = withRetention.definitionId;

      const noRetention = await createProcessDefinition(trx, {
        organisationId,
        key: 'retention-no-window',
        name: 'No retention window',
        referencePrefix: 'RETN',
        createdByUserId: userId,
      });
      definitionNoRetentionId = noRetention.definitionId;

      const version = await createProcessVersion(trx, {
        organisationId,
        definitionId: definitionWithRetentionId,
        versionNumber: 1,
        documentId: `doc-${generateId()}`,
        documentHash: 'sha256-placeholder',
      });
      versionId = version.versionId;
      await publishProcessVersion(trx, versionId, userId);
    });
  });

  afterAll(async () => {
    await db.deleteFrom('organisations').where('organisation_id', '=', organisationId).execute();
    await db.deleteFrom('users').where('user_id', '=', userId).execute();
    await db.destroy();
  });

  it("is eligible once completed past its definition's retention window", async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const eligibleCase = await createCompletedCase(definitionWithRetentionId, tenDaysAgo);

    const eligible = await findCasesEligibleForRedaction(db, new Date());

    expect(eligible.map((c) => c.caseId)).toContain(eligibleCase.caseId);
  });

  it('is not eligible while still within the retention window', async () => {
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const recentCase = await createCompletedCase(definitionWithRetentionId, oneDayAgo);

    const eligible = await findCasesEligibleForRedaction(db, new Date());

    expect(eligible.map((c) => c.caseId)).not.toContain(recentCase.caseId);
  });

  it('is never eligible when its definition has no retention window configured', async () => {
    const longAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    // No pinned version exists for definitionNoRetentionId; the join only
    // needs the definition side to prove the null-retention_days filter,
    // so the case still points at versionId (the with-retention
    // definition's version), which is enough for this repository-level
    // check without a second version to set up.
    const noRetentionCase = await createCompletedCase(definitionNoRetentionId, longAgo);

    const eligible = await findCasesEligibleForRedaction(db, new Date());

    expect(eligible.map((c) => c.caseId)).not.toContain(noRetentionCase.caseId);
  });

  it('is not eligible once already redacted', async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const redactedCase = await createCompletedCase(definitionWithRetentionId, tenDaysAgo);

    await withTenantTransaction(db, organisationId, (trx) =>
      markCaseRedacted(trx, redactedCase.caseId, new Date()),
    );

    const eligible = await findCasesEligibleForRedaction(db, new Date());

    expect(eligible.map((c) => c.caseId)).not.toContain(redactedCase.caseId);
  });

  it('clears a retention window back to indefinite via updateProcessDefinitionMetadata', async () => {
    const updated = await withTenantTransaction(db, organisationId, (trx) =>
      updateProcessDefinitionMetadata(trx, definitionWithRetentionId, { retentionDays: null }),
    );
    expect(updated.retentionDays).toBeNull();

    // Restored, so the other tests in this file (which run against the
    // same shared definition) are not order-dependent on this one.
    await withTenantTransaction(db, organisationId, (trx) =>
      updateProcessDefinitionMetadata(trx, definitionWithRetentionId, { retentionDays: 7 }),
    );
  });

  it('redactAttachment blanks the filename and marks it deleted', async () => {
    const targetCase = await createCompletedCase(
      definitionWithRetentionId,
      new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    );

    const attachment = await withTenantTransaction(db, organisationId, async (trx) => {
      const created = await createAttachment(trx, {
        attachmentId: generateId(),
        organisationId,
        caseId: targetCase.caseId,
        fieldKey: 'quote',
        filename: 'jane-doe-passport.pdf',
        declaredMimeType: 'application/pdf',
        sizeBytes: 1024,
        storageKey: `${organisationId}/cases/${targetCase.caseId}/quote.pdf`,
        uploadedByUserId: userId,
      });
      await redactAttachment(trx, created.attachmentId, new Date());
      return created;
    });

    const row = await db
      .selectFrom('attachments')
      .selectAll()
      .where('attachment_id', '=', attachment.attachmentId)
      .executeTakeFirstOrThrow();

    expect(row.filename).toBe('[REDACTED]');
    expect(row.deleted_at).not.toBeNull();
  });
});
