import {
  createCase,
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
import { createMongoClient } from '@orgflow/documents';
import { createDummyEmailSender } from '@orgflow/email';
import { createDummyFileStore } from '@orgflow/storage';
import { createDummyPublisher, type DummyDomainEventPublisher } from '@orgflow/events';
import type { OrganisationRole } from '@orgflow/types';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { buildSessionClaims, createSessionToken, SESSION_COOKIE_NAME } from '../auth/session.js';
import { createLogger } from '../logger.js';

const SESSION_SECRET = '11'.repeat(32);

describe('case comments API against real Postgres', () => {
  let db: Kysely<Database>;
  let mongoClient: MongoClient;
  let publisher: DummyDomainEventPublisher;
  let organisationId: string;
  let submitterCookie: string;
  let adminCookie: string;
  let outsiderCookie: string;
  let caseId: string;
  let otherOrganisationId: string;
  let otherAdminCookie: string;

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

  async function memberWithRoles(label: string, roles: OrganisationRole[], orgId: string) {
    const user = await createUserWithIdentity(db, {
      email: `${label}-${generateId()}@example.invalid`,
      displayName: label,
      issuer: 'urn:orgflow:test',
      subject: `${label}-${generateId()}`,
    });
    await withTenantTransaction(db, orgId, (trx) =>
      insertOrganisationMember(trx, { organisationId: orgId, userId: user.userId, roles }),
    );
    return { userId: user.userId, cookie: await cookieFor(user.userId, roles, orgId) };
  }

  beforeEach(() => {
    publisher = createDummyPublisher();
  });

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    mongoClient = await createMongoClient({ uri: process.env.ORGFLOW_TEST_MONGODB_URI! });

    // A bootstrap user only to satisfy createOrganisation's own
    // createdByUserId, distinct from the "submitter" this test actually
    // exercises: memberWithRoles needs a real organisation id to insert a
    // membership row against, which does not exist yet at this point.
    const bootstrapUser = await createUserWithIdentity(db, {
      email: `cc-bootstrap-${generateId()}@example.invalid`,
      displayName: 'CC Bootstrap',
      issuer: 'urn:orgflow:test',
      subject: `cc-bootstrap-${generateId()}`,
    });
    const organisation = await createOrganisation(db, {
      name: 'Case comments tenant',
      slug: `case-comments-${generateId()}`,
      createdByUserId: bootstrapUser.userId,
    });
    organisationId = organisation.organisationId;

    const realSubmitter = await memberWithRoles('cc-submitter', ['member'], organisationId);
    submitterCookie = realSubmitter.cookie;

    const admin = await memberWithRoles('cc-admin', ['admin', 'member'], organisationId);
    adminCookie = admin.cookie;

    const outsider = await memberWithRoles('cc-outsider', ['member'], organisationId);
    outsiderCookie = outsider.cookie;

    caseId = await withTenantTransaction(db, organisationId, async (trx) => {
      const definition = await createProcessDefinition(trx, {
        organisationId,
        key: 'cc-test-process',
        name: 'Case comments test process',
        referencePrefix: 'CCT',
        createdByUserId: realSubmitter.userId,
      });
      const version = await createProcessVersion(trx, {
        organisationId,
        definitionId: definition.definitionId,
        versionNumber: 1,
        documentId: `doc-${generateId()}`,
        documentHash: 'sha256-placeholder',
      });
      await publishProcessVersion(trx, version.versionId, realSubmitter.userId);

      const draft = await createCase(trx, {
        organisationId,
        definitionId: definition.definitionId,
        versionId: version.versionId,
        title: 'A case comments test case',
        submittedByUserId: realSubmitter.userId,
      });
      const submitted = await updateCaseState(trx, {
        caseId: draft.caseId,
        expectedRowVersion: draft.rowVersion,
        reference: `CCT-${generateId()}`,
        status: 'active',
        submittedAt: new Date(),
      });
      return submitted.caseId;
    });

    const otherOwner = await createUserWithIdentity(db, {
      email: `cc-other-owner-${generateId()}@example.invalid`,
      displayName: 'CC Other Owner',
      issuer: 'urn:orgflow:test',
      subject: `cc-other-owner-${generateId()}`,
    });
    const otherOrganisation = await createOrganisation(db, {
      name: 'Case comments other tenant',
      slug: `case-comments-other-${generateId()}`,
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
    otherAdminCookie = await cookieFor(
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
      publisher,
      emailSender: createDummyEmailSender(),
      fileStore: createDummyFileStore(),
      corsOrigin: 'http://localhost:3000',
      logger: createLogger('silent'),
      sessionSecret: SESSION_SECRET,
      isLocal: true,
      apiBaseUrl: 'http://localhost:4000',
    });
  }

  it('lets the requester post a comment, visible to them and to an admin', async () => {
    const posted = await request(app())
      .post(`/api/v1/cases/${caseId}/comments`)
      .set('Cookie', submitterCookie)
      .send({ body: 'Can you tell me more about this step?' });

    expect(posted.status).toBe(201);
    expect(posted.body.visibility).toBe('all');

    // The notify-on-comment worker's own trigger: one case.commented event,
    // naming the case and the comment it is about, not its content (the
    // worker re-reads that itself rather than trusting the event payload).
    expect(publisher.published).toHaveLength(1);
    expect(publisher.published[0]?.eventType).toBe('case.commented');
    expect(publisher.published[0]?.payload).toEqual({
      caseId,
      commentId: posted.body.commentId,
    });

    const asSubmitter = await request(app())
      .get(`/api/v1/cases/${caseId}/comments`)
      .set('Cookie', submitterCookie);
    expect(asSubmitter.body.data.map((c: { body: string }) => c.body)).toContain(
      'Can you tell me more about this step?',
    );

    const asAdmin = await request(app())
      .get(`/api/v1/cases/${caseId}/comments`)
      .set('Cookie', adminCookie);
    expect(asAdmin.body.data.map((c: { body: string }) => c.body)).toContain(
      'Can you tell me more about this step?',
    );
  });

  it('refuses the requester an internal note, but lets an admin post one', async () => {
    const refused = await request(app())
      .post(`/api/v1/cases/${caseId}/comments`)
      .set('Cookie', submitterCookie)
      .send({ body: 'Trying to sneak an internal note.', visibility: 'approvers' });
    expect(refused.status).toBe(403);

    const posted = await request(app())
      .post(`/api/v1/cases/${caseId}/comments`)
      .set('Cookie', adminCookie)
      .send({ body: 'Internal-only note from an admin.', visibility: 'approvers' });
    expect(posted.status).toBe(201);
    expect(posted.body.visibility).toBe('approvers');
  });

  it('hides an internal note from the requester, but shows it to an admin', async () => {
    await request(app())
      .post(`/api/v1/cases/${caseId}/comments`)
      .set('Cookie', adminCookie)
      .send({ body: 'Only approvers should see this one.', visibility: 'approvers' });

    const asSubmitter = await request(app())
      .get(`/api/v1/cases/${caseId}/comments`)
      .set('Cookie', submitterCookie);
    expect(asSubmitter.body.data.map((c: { body: string }) => c.body)).not.toContain(
      'Only approvers should see this one.',
    );

    const asAdmin = await request(app())
      .get(`/api/v1/cases/${caseId}/comments`)
      .set('Cookie', adminCookie);
    expect(asAdmin.body.data.map((c: { body: string }) => c.body)).toContain(
      'Only approvers should see this one.',
    );
  });

  it('404s the comments list for someone who cannot view the case at all', async () => {
    const response = await request(app())
      .get(`/api/v1/cases/${caseId}/comments`)
      .set('Cookie', outsiderCookie);

    expect(response.status).toBe(404);
  });

  it('404s a cross-tenant case, not 403', async () => {
    const getResponse = await request(app())
      .get(`/api/v1/cases/${caseId}/comments`)
      .set('Cookie', otherAdminCookie);
    expect(getResponse.status).toBe(404);

    const postResponse = await request(app())
      .post(`/api/v1/cases/${caseId}/comments`)
      .set('Cookie', otherAdminCookie)
      .send({ body: 'Should never land.' });
    expect(postResponse.status).toBe(404);
  });

  it('rejects an empty comment body', async () => {
    const response = await request(app())
      .post(`/api/v1/cases/${caseId}/comments`)
      .set('Cookie', submitterCookie)
      .send({ body: '' });

    expect(response.status).toBe(400);
  });
});
