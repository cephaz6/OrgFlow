import {
  createDb,
  createOrganisation,
  createUserWithIdentity,
  ensureGroup,
  generateId,
  insertOrganisationMember,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import { createMongoClient } from '@orgflow/documents';
import { createDummyEmailSender } from '@orgflow/email';
import { createDummyPublisher } from '@orgflow/events';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { buildSessionClaims, createSessionToken, SESSION_COOKIE_NAME } from '../auth/session.js';
import { createLogger } from '../logger.js';

const SESSION_SECRET = '88'.repeat(32);

describe('groups API against real Postgres', () => {
  let db: Kysely<Database>;
  let mongoClient: MongoClient;

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    mongoClient = await createMongoClient({ uri: process.env.ORGFLOW_TEST_MONGODB_URI! });
  });

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

  it("lists every group in the caller's own organisation, and none from another", async () => {
    const user = await createUserWithIdentity(db, {
      email: `${generateId()}@example.invalid`,
      displayName: 'Test member',
      issuer: 'urn:orgflow:test',
      subject: generateId(),
    });
    const organisationId = (
      await createOrganisation(db, {
        name: `org-${generateId()}`,
        slug: `org-${generateId()}`,
        createdByUserId: user.userId,
      })
    ).organisationId;

    await withTenantTransaction(db, organisationId, async (trx) => {
      await insertOrganisationMember(trx, {
        organisationId,
        userId: user.userId,
        roles: ['member'],
      });
      await ensureGroup(trx, { organisationId, key: `it-${generateId()}`, name: 'IT' });
      await ensureGroup(trx, { organisationId, key: `finance-${generateId()}`, name: 'Finance' });
    });

    const otherOrgOwner = await createUserWithIdentity(db, {
      email: `${generateId()}@example.invalid`,
      displayName: 'Other org owner',
      issuer: 'urn:orgflow:test',
      subject: generateId(),
    });
    const otherOrganisationId = (
      await createOrganisation(db, {
        name: `org-${generateId()}`,
        slug: `org-${generateId()}`,
        createdByUserId: otherOrgOwner.userId,
      })
    ).organisationId;
    await withTenantTransaction(db, otherOrganisationId, (trx) =>
      ensureGroup(trx, {
        organisationId: otherOrganisationId,
        key: `secret-${generateId()}`,
        name: 'Secret group',
      }),
    );

    const token = await createSessionToken(
      SESSION_SECRET,
      buildSessionClaims(user.userId, organisationId, ['member']),
    );
    const app = buildApp();

    const response = await request(app)
      .get('/api/v1/groups')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`);

    expect(response.status).toBe(200);
    const names = response.body.data.map((group: { name: string }) => group.name).sort();
    expect(names).toEqual(['Finance', 'IT']);
  });

  it('refuses an unauthenticated request', async () => {
    const app = buildApp();
    const response = await request(app).get('/api/v1/groups');
    expect(response.status).toBe(401);
  });
});
