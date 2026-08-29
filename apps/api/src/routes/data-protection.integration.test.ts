import {
  createAttachment,
  createCase,
  createCaseTask,
  createDb,
  createOrganisation,
  createProcessDefinition,
  createProcessVersion,
  createUserWithIdentity,
  generateId,
  insertOrganisationMember,
  publishProcessVersion,
  updateCaseState,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import { createMongoClient, upsertCaseValues } from '@orgflow/documents';
import { createDummyEmailSender } from '@orgflow/email';
import { createDummyFileStore } from '@orgflow/storage';
import { createDummyPublisher } from '@orgflow/events';
import type { OrganisationRole } from '@orgflow/types';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { buildSessionClaims, createSessionToken, SESSION_COOKIE_NAME } from '../auth/session.js';
import { createLogger } from '../logger.js';

const SESSION_SECRET = '99'.repeat(32);

describe('data protection API against real Postgres and Mongo', () => {
  let db: Kysely<Database>;
  let mongoClient: MongoClient;
  let organisationId: string;
  let adminCookie: string;
  let adminUserId: string;
  let memberCookie: string;
  let subjectUserId: string;
  let caseId: string;
  let otherOrganisationId: string;
  let otherTenantAdminCookie: string;

  async function cookieFor(
    userId: string,
    roles: OrganisationRole[],
    orgId: string,
  ): Promise<string> {
    const token = await createSessionToken(
      SESSION_SECRET,
      buildSessionClaims(userId, orgId, roles),
    );
    return `${SESSION_COOKIE_NAME}=${token}`;
  }

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    mongoClient = await createMongoClient({ uri: process.env.ORGFLOW_TEST_MONGODB_URI! });

    const owner = await createUserWithIdentity(db, {
      email: `dp-owner-${generateId()}@example.invalid`,
      displayName: 'DP Owner',
      issuer: 'urn:orgflow:test',
      subject: `dp-owner-${generateId()}`,
    });
    const organisation = await createOrganisation(db, {
      name: 'DP tenant',
      slug: `dp-tenant-${generateId()}`,
      createdByUserId: owner.userId,
    });
    organisationId = organisation.organisationId;
    adminUserId = owner.userId;
    await withTenantTransaction(db, organisationId, (trx) =>
      insertOrganisationMember(trx, {
        organisationId,
        userId: owner.userId,
        roles: ['owner', 'admin', 'member'],
      }),
    );
    adminCookie = await cookieFor(owner.userId, ['owner', 'admin', 'member'], organisationId);

    const plain = await createUserWithIdentity(db, {
      email: `dp-plain-${generateId()}@example.invalid`,
      displayName: 'DP Plain',
      issuer: 'urn:orgflow:test',
      subject: `dp-plain-${generateId()}`,
    });
    await withTenantTransaction(db, organisationId, (trx) =>
      insertOrganisationMember(trx, {
        organisationId,
        userId: plain.userId,
        roles: ['member'],
      }),
    );
    memberCookie = await cookieFor(plain.userId, ['member'], organisationId);

    const subject = await createUserWithIdentity(db, {
      email: `dp-subject-${generateId()}@example.invalid`,
      displayName: 'DP Subject',
      issuer: 'urn:orgflow:test',
      subject: `dp-subject-${generateId()}`,
    });
    subjectUserId = subject.userId;
    await withTenantTransaction(db, organisationId, (trx) =>
      insertOrganisationMember(trx, {
        organisationId,
        userId: subjectUserId,
        roles: ['member'],
      }),
    );

    await withTenantTransaction(db, organisationId, async (trx) => {
      const definition = await createProcessDefinition(trx, {
        organisationId,
        key: 'dp-test-process',
        name: 'DP test process',
        referencePrefix: 'DPT',
        createdByUserId: owner.userId,
      });
      const version = await createProcessVersion(trx, {
        organisationId,
        definitionId: definition.definitionId,
        versionNumber: 1,
        documentId: `doc-${generateId()}`,
        documentHash: 'sha256-placeholder',
      });
      await publishProcessVersion(trx, version.versionId, owner.userId);

      const draft = await createCase(trx, {
        organisationId,
        definitionId: definition.definitionId,
        versionId: version.versionId,
        title: 'A DP test case',
        submittedByUserId: subjectUserId,
      });
      const submitted = await updateCaseState(trx, {
        caseId: draft.caseId,
        expectedRowVersion: draft.rowVersion,
        reference: `DPT-${generateId()}`,
        submittedAt: new Date(),
      });
      caseId = submitted.caseId;

      await createCaseTask(trx, {
        organisationId,
        caseId,
        stepKey: 'approve',
        stepName: 'Approve',
        taskType: 'approval',
        assignmentStrategy: 'user',
        assigneeUserId: owner.userId,
      });

      await createAttachment(trx, {
        attachmentId: generateId(),
        organisationId,
        caseId,
        fieldKey: 'quote',
        filename: 'quote.pdf',
        declaredMimeType: 'application/pdf',
        sizeBytes: 2048,
        storageKey: `${organisationId}/cases/${caseId}/quote.pdf`,
        uploadedByUserId: subjectUserId,
      });
    });

    await upsertCaseValues(mongoClient, {
      organisationId,
      caseId,
      values: { justification: 'Need a laptop for testing.' },
      now: new Date().toISOString(),
    });

    const otherOwner = await createUserWithIdentity(db, {
      email: `dp-other-owner-${generateId()}@example.invalid`,
      displayName: 'DP Other Owner',
      issuer: 'urn:orgflow:test',
      subject: `dp-other-owner-${generateId()}`,
    });
    const otherOrganisation = await createOrganisation(db, {
      name: 'DP other tenant',
      slug: `dp-other-tenant-${generateId()}`,
      createdByUserId: otherOwner.userId,
    });
    otherOrganisationId = otherOrganisation.organisationId;
    await withTenantTransaction(db, otherOrganisationId, (trx) =>
      insertOrganisationMember(trx, {
        organisationId: otherOrganisationId,
        userId: otherOwner.userId,
        roles: ['owner', 'admin', 'member'],
      }),
    );
    otherTenantAdminCookie = await cookieFor(
      otherOwner.userId,
      ['owner', 'admin', 'member'],
      otherOrganisationId,
    );
  });

  afterAll(async () => {
    await db.destroy();
    await mongoClient.close();
  });

  function app() {
    return createApp({
      db,
      mongoClient,
      publisher: createDummyPublisher(),
      emailSender: createDummyEmailSender(),
      fileStore: createDummyFileStore(),
      corsOrigin: 'http://localhost:3000',
      logger: createLogger('silent'),
      sessionSecret: SESSION_SECRET,
      isLocal: true,
      apiBaseUrl: 'http://localhost:4000',
    });
  }

  it('refuses the export to a member without the admin role', async () => {
    const response = await request(app())
      .get('/api/v1/data-protection/subject-export')
      .query({ userId: subjectUserId })
      .set('Cookie', memberCookie);

    expect(response.status).toBe(403);
  });

  it('returns complete data for the subject: their case, its values, and their upload', async () => {
    const response = await request(app())
      .get('/api/v1/data-protection/subject-export')
      .query({ userId: subjectUserId })
      .set('Cookie', adminCookie);

    expect(response.status).toBe(200);
    expect(response.body.user.userId).toBe(subjectUserId);
    expect(response.body.casesSubmitted).toHaveLength(1);
    expect(response.body.casesSubmitted[0].caseId).toBe(caseId);
    expect(response.body.casesSubmitted[0].values).toEqual({
      justification: 'Need a laptop for testing.',
    });
    expect(response.body.attachmentsUploaded).toHaveLength(1);
    expect(response.body.attachmentsUploaded[0].filename).toBe('quote.pdf');
    expect(typeof response.body.exportedAt).toBe('string');
  });

  it('audits the export request against the subject, attributed to the admin who ran it', async () => {
    await request(app())
      .get('/api/v1/data-protection/subject-export')
      .query({ userId: subjectUserId })
      .set('Cookie', adminCookie);

    // Queried directly, not through the route's own response: the export
    // is written against the subject as entity, not as actor, so it would
    // never appear in the subject's own auditEvents list (that list is
    // actions the subject took, and requesting your own export is not
    // something the subject did here, an admin did it to their record).
    const written = await db
      .selectFrom('audit_events')
      .selectAll()
      .where('organisation_id', '=', organisationId)
      .where('entity_type', '=', 'user')
      .where('entity_id', '=', subjectUserId)
      .where('action', '=', 'subject_access_export.requested')
      .execute();

    expect(written.length).toBeGreaterThan(0);
    expect(written[0]?.actor_user_id).toBe(adminUserId);
  });

  it('404s a userId that is not a member of this organisation, not 403', async () => {
    const response = await request(app())
      .get('/api/v1/data-protection/subject-export')
      .query({ userId: '00000000-0000-4000-8000-000000000000' })
      .set('Cookie', adminCookie);

    expect(response.status).toBe(404);
  });

  it('cannot export a member of a different tenant, even by their real userId', async () => {
    const response = await request(app())
      .get('/api/v1/data-protection/subject-export')
      .query({ userId: subjectUserId })
      .set('Cookie', otherTenantAdminCookie);

    expect(response.status).toBe(404);
  });
});
