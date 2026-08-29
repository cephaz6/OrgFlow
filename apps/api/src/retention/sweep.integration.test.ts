import {
  createAttachment,
  createCase,
  createDb,
  createOrganisation,
  createProcessDefinition,
  createProcessVersion,
  createUserWithIdentity,
  findAttachmentById,
  generateId,
  markAttachmentConfirmed,
  publishProcessVersion,
  updateCaseState,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import {
  createMongoClient,
  ensureIndexes,
  insertProcessDefinitionDocument,
  readCaseValues,
  upsertCaseValues,
} from '@orgflow/documents';
import { createDummyFileStore, type DummyFileStore } from '@orgflow/storage';
import type { ProcessDefinitionDocument } from '@orgflow/types';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLogger } from '../logger.js';
import { runRetentionSweepOnce } from './sweep.js';

// Backdates completed_at directly, the same "fast-forward" reasoning
// sla-sweep.integration.test.ts uses for fire_at: proving "10 days past a
// 7-day window" for real would mean waiting 10 real days.
describe('the retention sweep against real Postgres and Mongo', () => {
  let db: Kysely<Database>;
  let mongoClient: MongoClient;
  let fileStore: DummyFileStore;
  let organisationId: string;
  let userId: string;

  function baseDocument(overrides: Partial<ProcessDefinitionDocument> = {}) {
    return {
      organisationId,
      definitionId: generateId(),
      versionNumber: 1,
      key: 'retention-sweep-test',
      name: 'Retention sweep test',
      form: {
        titleFieldKey: 'justification',
        sections: [
          {
            key: 'details',
            title: 'Details',
            fields: [
              { key: 'justification', type: 'text', label: 'Justification' },
              {
                key: 'homeAddress',
                type: 'text',
                label: 'Home address',
                containsPersonalData: true,
              },
            ],
          },
        ],
      },
      workflow: { startStepKey: '$completed', steps: [] },
      createdByUserId: userId,
      createdAt: new Date().toISOString(),
      ...overrides,
    } satisfies ProcessDefinitionDocument;
  }

  async function setUpCase(options: {
    retentionDays: number | null;
    completedAt: Date;
    values: Record<string, unknown>;
  }) {
    return withTenantTransaction(db, organisationId, async (trx) => {
      const definition = await createProcessDefinition(trx, {
        organisationId,
        key: `retention-sweep-${generateId()}`,
        name: 'Retention sweep test process',
        referencePrefix: 'RSW',
        retentionDays: options.retentionDays,
        createdByUserId: userId,
      });

      const document = baseDocument({ definitionId: definition.definitionId });
      const stored = await insertProcessDefinitionDocument(mongoClient, document);

      const version = await createProcessVersion(trx, {
        organisationId,
        definitionId: definition.definitionId,
        versionNumber: 1,
        documentId: stored.documentId,
        documentHash: stored.documentHash,
      });
      await publishProcessVersion(trx, version.versionId, userId);

      const draft = await createCase(trx, {
        organisationId,
        definitionId: definition.definitionId,
        versionId: version.versionId,
        title: 'A retention sweep test case',
        submittedByUserId: userId,
      });
      const submitted = await updateCaseState(trx, {
        caseId: draft.caseId,
        expectedRowVersion: draft.rowVersion,
        reference: `RSW-${generateId()}`,
        status: 'completed',
        submittedAt: options.completedAt,
        completedAt: options.completedAt,
      });

      return { definition, case: submitted };
    }).then(async (result) => {
      await upsertCaseValues(mongoClient, {
        organisationId,
        caseId: result.case.caseId,
        values: options.values,
        now: new Date().toISOString(),
      });
      return result;
    });
  }

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    mongoClient = await createMongoClient({ uri: process.env.ORGFLOW_TEST_MONGODB_URI! });
    await ensureIndexes(mongoClient);

    const user = await createUserWithIdentity(db, {
      email: `retention-sweep-${generateId()}@example.invalid`,
      displayName: 'Retention Sweep Test User',
      issuer: 'urn:orgflow:test',
      subject: `retention-sweep-${generateId()}`,
    });
    userId = user.userId;

    const organisation = await createOrganisation(db, {
      name: 'Retention sweep tenant',
      slug: `retention-sweep-${generateId()}`,
      createdByUserId: userId,
    });
    organisationId = organisation.organisationId;
  });

  afterAll(async () => {
    await db.deleteFrom('organisations').where('organisation_id', '=', organisationId).execute();
    await db.deleteFrom('users').where('user_id', '=', userId).execute();
    await db.destroy();
  });

  it('redacts a case past its retention window: tombstones flagged fields, deletes attachments, sets redacted_at, and audits it', async () => {
    fileStore = createDummyFileStore();
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const { case: eligibleCase } = await setUpCase({
      retentionDays: 7,
      completedAt: tenDaysAgo,
      values: { justification: 'Needed for a project.', homeAddress: '1 Real Street' },
    });

    const attachment = await withTenantTransaction(db, organisationId, async (trx) => {
      const created = await createAttachment(trx, {
        attachmentId: generateId(),
        organisationId,
        caseId: eligibleCase.caseId,
        fieldKey: 'proof',
        filename: 'jane-doe-proof.pdf',
        declaredMimeType: 'application/pdf',
        sizeBytes: 1024,
        storageKey: `${organisationId}/cases/${eligibleCase.caseId}/proof.pdf`,
        uploadedByUserId: userId,
      });
      // Only a confirmed upload is redaction-eligible
      // (findConfirmedAttachmentsForCase, the same read the case detail
      // view uses): an abandoned presign was never a real file to delete.
      return markAttachmentConfirmed(trx, created.attachmentId, new Date());
    });
    fileStore.objects.set(attachment.storageKey, { bytes: Buffer.from('pdf'), sizeBytes: 3 });

    await runRetentionSweepOnce({ db, mongoClient, fileStore, logger: createLogger('silent') });

    const values = await readCaseValues(mongoClient, organisationId, eligibleCase.caseId);
    expect(values.homeAddress).toBe('[REDACTED]');
    expect(values.justification).toBe('Needed for a project.');

    expect(fileStore.objects.has(attachment.storageKey)).toBe(false);

    const redactedAttachment = await withTenantTransaction(db, organisationId, (trx) =>
      findAttachmentById(trx, attachment.attachmentId),
    );
    expect(redactedAttachment?.filename).toBe('[REDACTED]');
    expect(redactedAttachment?.deletedAt).not.toBeNull();

    const auditRows = await db
      .selectFrom('audit_events')
      .selectAll()
      .where('entity_type', '=', 'case')
      .where('entity_id', '=', eligibleCase.caseId)
      .where('action', '=', 'case.redacted')
      .execute();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.actor_type).toBe('scheduler');
  });

  it('does not redact a case still within its retention window', async () => {
    fileStore = createDummyFileStore();
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const { case: recentCase } = await setUpCase({
      retentionDays: 7,
      completedAt: oneDayAgo,
      values: { justification: 'Recent', homeAddress: '2 Real Street' },
    });

    await runRetentionSweepOnce({ db, mongoClient, fileStore, logger: createLogger('silent') });

    const values = await readCaseValues(mongoClient, organisationId, recentCase.caseId);
    expect(values.homeAddress).toBe('2 Real Street');
  });

  it('does not redact a case whose definition has no retention window', async () => {
    fileStore = createDummyFileStore();
    const longAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const { case: indefiniteCase } = await setUpCase({
      retentionDays: null,
      completedAt: longAgo,
      values: { justification: 'Kept indefinitely', homeAddress: '3 Real Street' },
    });

    await runRetentionSweepOnce({ db, mongoClient, fileStore, logger: createLogger('silent') });

    const values = await readCaseValues(mongoClient, organisationId, indefiniteCase.caseId);
    expect(values.homeAddress).toBe('3 Real Street');
  });

  it('does not redact the same case twice on a second sweep', async () => {
    fileStore = createDummyFileStore();
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const { case: eligibleCase } = await setUpCase({
      retentionDays: 7,
      completedAt: tenDaysAgo,
      values: { justification: 'Once redacted', homeAddress: '4 Real Street' },
    });

    const deps = { db, mongoClient, fileStore, logger: createLogger('silent') };
    await runRetentionSweepOnce(deps);
    await runRetentionSweepOnce(deps);

    const auditRows = await db
      .selectFrom('audit_events')
      .selectAll()
      .where('entity_type', '=', 'case')
      .where('entity_id', '=', eligibleCase.caseId)
      .where('action', '=', 'case.redacted')
      .execute();
    expect(auditRows).toHaveLength(1);
  });
});
