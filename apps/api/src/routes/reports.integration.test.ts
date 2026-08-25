import {
  createCase,
  createCaseTask,
  createDb,
  createOrganisation,
  createUserWithIdentity,
  generateId,
  insertOrganisationMember,
  updateCaseState,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import { createMongoClient, ensureIndexes } from '@orgflow/documents';
import { createDummyEmailSender } from '@orgflow/email';
import { createDummyPublisher } from '@orgflow/events';
import type { OrganisationRole } from '@orgflow/types';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { buildSessionClaims, createSessionToken, SESSION_COOKIE_NAME } from '../auth/session.js';
import { createLogger } from '../logger.js';
import { ensureLaptopRequestSeeded } from '../seed/laptop-request.js';

const SESSION_SECRET = '55'.repeat(32);
const HOUR = 60 * 60 * 1000;

describe('reports API against real Postgres and Mongo', () => {
  let db: Kysely<Database>;
  let mongoClient: MongoClient;
  let organisationId: string;
  let definitionId: string;
  let versionId: string;
  let ownerUserId: string;
  let ownerCookie: string;
  let memberCookie: string;
  let processOwnerCookie: string;
  let adminCookie: string;

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    mongoClient = await createMongoClient({ uri: process.env.ORGFLOW_TEST_MONGODB_URI! });
    await ensureIndexes(mongoClient);

    const owner = await createUserWithIdentity(db, {
      email: `report-owner-${generateId()}@example.invalid`,
      displayName: 'Report Owner',
      issuer: 'urn:orgflow:test',
      subject: `report-owner-${generateId()}`,
    });
    const organisation = await createOrganisation(db, {
      name: 'Reports tenant',
      slug: `reports-tenant-${generateId()}`,
      createdByUserId: owner.userId,
    });
    organisationId = organisation.organisationId;

    await withTenantTransaction(db, organisationId, (trx) =>
      insertOrganisationMember(trx, {
        organisationId,
        userId: owner.userId,
        roles: ['owner', 'admin', 'processOwner', 'approver', 'member'],
      }),
    );

    const seeded = await ensureLaptopRequestSeeded(db, mongoClient, {
      organisationId,
      ownerUserId: owner.userId,
    });
    definitionId = seeded.definitionId;
    versionId = seeded.versionId;
    ownerUserId = owner.userId;

    async function cookieFor(userId: string, roles: OrganisationRole[]): Promise<string> {
      const token = await createSessionToken(
        SESSION_SECRET,
        buildSessionClaims(userId, organisationId, roles),
      );
      return `${SESSION_COOKIE_NAME}=${token}`;
    }

    async function memberWithRoles(label: string, roles: OrganisationRole[]) {
      const user = await createUserWithIdentity(db, {
        email: `${label}-${generateId()}@example.invalid`,
        displayName: label,
        issuer: 'urn:orgflow:test',
        subject: `${label}-${generateId()}`,
      });
      await withTenantTransaction(db, organisationId, (trx) =>
        insertOrganisationMember(trx, { organisationId, userId: user.userId, roles }),
      );
      return cookieFor(user.userId, roles);
    }

    ownerCookie = await cookieFor(owner.userId, [
      'owner',
      'admin',
      'processOwner',
      'approver',
      'member',
    ]);
    memberCookie = await memberWithRoles('member-only', ['member']);
    processOwnerCookie = await memberWithRoles('process-owner-only', ['processOwner']);
    adminCookie = await memberWithRoles('admin-only', ['admin']);

    // A handful of completed and rejected cases so the aggregate endpoints
    // have something real to compute over.
    // Relative to now, not a fixed calendar date: the report routes default
    // to a 90-day window ending now when a request carries no explicit
    // from/to, and these fixtures are read through that default in several
    // of the tests below.
    const submittedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

    for (const [status, hours] of [
      ['completed', 2],
      ['completed', 4],
      ['rejected', 1],
    ] as const) {
      await withTenantTransaction(db, organisationId, async (trx) => {
        const created = await createCase(trx, {
          organisationId,
          definitionId,
          versionId,
          title: 'Reporting fixture',
          submittedByUserId: owner.userId,
        });
        await updateCaseState(trx, {
          caseId: created.caseId,
          expectedRowVersion: created.rowVersion,
          status,
          submittedAt,
          completedAt: new Date(submittedAt.getTime() + hours * HOUR),
        });
        await createCaseTask(trx, {
          organisationId,
          caseId: created.caseId,
          stepKey: 'managerApproval',
          stepName: 'Line manager approval',
          taskType: 'approval',
          assignmentStrategy: 'lineManager',
          assigneeUserId: owner.userId,
        });
      });
    }
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await mongoClient.close();
  });

  function buildApp() {
    return createApp({
      db,
      mongoClient,
      publisher: createDummyPublisher(),
      emailSender: createDummyEmailSender(),
      corsOrigin: 'http://localhost:3000',
      logger: createLogger('silent'),
      sessionSecret: SESSION_SECRET,
      isLocal: true,
      apiBaseUrl: 'http://localhost:4000',
    });
  }

  describe('GET /reports/overview', () => {
    it('returns volume and turnaround for a processOwner session', async () => {
      const response = await request(buildApp())
        .get('/api/v1/reports/overview')
        .set('Cookie', processOwnerCookie);

      expect(response.status).toBe(200);
      expect(response.body.volume).toBeInstanceOf(Array);
      expect(
        typeof response.body.completionRate === 'number' || response.body.completionRate === null,
      ).toBe(true);
    });

    it('rejects a plain member with a 403 problem response', async () => {
      const response = await request(buildApp())
        .get('/api/v1/reports/overview')
        .set('Cookie', memberCookie);

      expect(response.status).toBe(403);
      expect(response.body.status).toBe(403);
      expect(response.body.title).toBeTruthy();
    });
  });

  describe('GET /reports/definitions/:id', () => {
    it('returns the per-definition report for an admin session', async () => {
      const response = await request(buildApp())
        .get(`/api/v1/reports/definitions/${definitionId}`)
        .set('Cookie', adminCookie);

      expect(response.status).toBe(200);
      expect(response.body.definitionId).toBe(definitionId);
      expect(response.body.volume).toBeGreaterThanOrEqual(3);
    });

    it('404s for a definition id that does not exist, not 403', async () => {
      const response = await request(buildApp())
        .get('/api/v1/reports/definitions/00000000-0000-0000-0000-000000000000')
        .set('Cookie', adminCookie);

      expect(response.status).toBe(404);
    });
  });

  describe('GET /reports/bottlenecks', () => {
    it('returns 200 with a data array for a processOwner session', async () => {
      const response = await request(buildApp())
        .get('/api/v1/reports/bottlenecks')
        .set('Cookie', processOwnerCookie);

      expect(response.status).toBe(200);
      expect(response.body.data).toBeInstanceOf(Array);
    });
  });

  describe('GET /reports/approver-load', () => {
    it('rejects a processOwner session, since this is the tighter individual-level gate', async () => {
      const response = await request(buildApp())
        .get('/api/v1/reports/approver-load')
        .set('Cookie', processOwnerCookie);

      expect(response.status).toBe(403);
    });

    it('allows an admin session', async () => {
      const response = await request(buildApp())
        .get('/api/v1/reports/approver-load')
        .set('Cookie', adminCookie);

      expect(response.status).toBe(200);
      expect(response.body.data).toBeInstanceOf(Array);
    });

    it('allows the owner session too', async () => {
      const response = await request(buildApp())
        .get('/api/v1/reports/approver-load')
        .set('Cookie', ownerCookie);

      expect(response.status).toBe(200);
    });
  });

  describe('POST /exports', () => {
    it('streams a CSV attachment with the expected header row', async () => {
      const response = await request(buildApp())
        .post('/api/v1/exports')
        .set('Cookie', adminCookie)
        .send({});

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.text.split('\r\n')[0]).toBe(
        'Reference,Title,Status,Current step,Submitted at,Completed at',
      );
    });

    it('quotes a title containing a comma correctly', async () => {
      await withTenantTransaction(db, organisationId, async (trx) => {
        const created = await createCase(trx, {
          organisationId,
          definitionId,
          versionId,
          title: 'Laptop, 14-inch',
          submittedByUserId: ownerUserId,
        });
        await updateCaseState(trx, {
          caseId: created.caseId,
          expectedRowVersion: created.rowVersion,
          status: 'active',
          submittedAt: new Date(),
        });
      });

      const response = await request(buildApp())
        .post('/api/v1/exports')
        .set('Cookie', adminCookie)
        .send({});

      expect(response.status).toBe(200);
      expect(response.text).toContain('"Laptop, 14-inch"');
    });

    it('rejects a plain member', async () => {
      const response = await request(buildApp())
        .post('/api/v1/exports')
        .set('Cookie', memberCookie)
        .send({});

      expect(response.status).toBe(403);
    });
  });
});
