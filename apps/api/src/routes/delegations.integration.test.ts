import {
  createDb,
  createOrganisation,
  createUserWithIdentity,
  generateId,
  insertOrganisationMember,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import { createMongoClient } from '@orgflow/documents';
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

describe('delegations API against real Postgres', () => {
  let db: Kysely<Database>;
  let mongoClient: MongoClient;
  let organisationId: string;

  async function cookieFor(userId: string, roles: OrganisationRole[]): Promise<string> {
    const token = await createSessionToken(
      SESSION_SECRET,
      buildSessionClaims(userId, organisationId, roles),
    );
    return `${SESSION_COOKIE_NAME}=${token}`;
  }

  async function memberWithIdentity(label: string, displayName: string, email: string) {
    const user = await createUserWithIdentity(db, {
      email,
      displayName,
      issuer: 'urn:orgflow:test',
      subject: `${label}-${generateId()}`,
    });
    await withTenantTransaction(db, organisationId, (trx) =>
      insertOrganisationMember(trx, { organisationId, userId: user.userId, roles: ['member'] }),
    );
    return { userId: user.userId, cookie: await cookieFor(user.userId, ['member']) };
  }

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    mongoClient = await createMongoClient({ uri: process.env.ORGFLOW_TEST_MONGODB_URI! });

    const owner = await createUserWithIdentity(db, {
      email: `delegations-owner-${generateId()}@example.invalid`,
      displayName: 'Delegations Owner',
      issuer: 'urn:orgflow:test',
      subject: `delegations-owner-${generateId()}`,
    });
    const organisation = await createOrganisation(db, {
      name: 'Delegations tenant',
      slug: `delegations-tenant-${generateId()}`,
      createdByUserId: owner.userId,
    });
    organisationId = organisation.organisationId;
    await withTenantTransaction(db, organisationId, (trx) =>
      insertOrganisationMember(trx, {
        organisationId,
        userId: owner.userId,
        roles: ['owner', 'admin', 'member'],
      }),
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

  it('creates a delegation and lists it for both sides, with a createdAt', async () => {
    const from = await memberWithIdentity(
      'from',
      'Delegation Sender',
      `sender-${generateId()}@example.invalid`,
    );
    const to = await memberWithIdentity(
      'to',
      'Delegation Recipient',
      `recipient-${generateId()}@example.invalid`,
    );

    const created = await request(app())
      .post('/api/v1/delegations')
      .set('Cookie', from.cookie)
      .send({
        toUserEmail: (await request(app()).get('/api/v1/auth/session').set('Cookie', to.cookie))
          .body.user.email,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 60_000).toISOString(),
        reason: 'Annual leave',
      });
    expect(created.status).toBe(201);
    expect(typeof created.body.delegation.createdAt).toBe('string');

    const fromList = await request(app()).get('/api/v1/delegations').set('Cookie', from.cookie);
    expect(fromList.status).toBe(200);
    expect(fromList.body.data).toHaveLength(1);
    expect(fromList.body.data[0].direction).toBe('outgoing');
    expect(fromList.body.data[0].counterpartName).toBe('Delegation Recipient');

    const toList = await request(app()).get('/api/v1/delegations').set('Cookie', to.cookie);
    expect(toList.status).toBe(200);
    expect(toList.body.data).toHaveLength(1);
    expect(toList.body.data[0].direction).toBe('incoming');
    expect(toList.body.data[0].counterpartName).toBe('Delegation Sender');
  });

  it('finds a delegation by the counterpart name, from either side', async () => {
    const from = await memberWithIdentity(
      'from2',
      'Search Sender',
      `search-sender-${generateId()}@example.invalid`,
    );
    const to = await memberWithIdentity(
      'to2',
      'Findable Counterpart',
      `findable-${generateId()}@example.invalid`,
    );
    const toEmail = (await request(app()).get('/api/v1/auth/session').set('Cookie', to.cookie)).body
      .user.email as string;

    await request(app())
      .post('/api/v1/delegations')
      .set('Cookie', from.cookie)
      .send({
        toUserEmail: toEmail,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 60_000).toISOString(),
      });

    const found = await request(app())
      .get('/api/v1/delegations')
      .query({ query: 'Findable Counterpart' })
      .set('Cookie', from.cookie);
    expect(found.status).toBe(200);
    expect(found.body.data).toHaveLength(1);

    const notFound = await request(app())
      .get('/api/v1/delegations')
      .query({ query: `no-such-name-${generateId()}` })
      .set('Cookie', from.cookie);
    expect(notFound.status).toBe(200);
    expect(notFound.body.data).toEqual([]);
  });

  it("paginates a user's delegations without repeating or skipping one", async () => {
    const from = await memberWithIdentity(
      'from3',
      'Page Sender',
      `page-sender-${generateId()}@example.invalid`,
    );
    const recipients = await Promise.all(
      [0, 1, 2].map((n) =>
        memberWithIdentity(
          `to3-${n}`,
          `Page Recipient ${n}`,
          `page-recip-${n}-${generateId()}@example.invalid`,
        ),
      ),
    );

    for (const recipient of recipients) {
      const email = (
        await request(app()).get('/api/v1/auth/session').set('Cookie', recipient.cookie)
      ).body.user.email as string;
      const created = await request(app())
        .post('/api/v1/delegations')
        .set('Cookie', from.cookie)
        .send({
          toUserEmail: email,
          startsAt: new Date(Date.now() - 60_000).toISOString(),
          endsAt: new Date(Date.now() + 60_000).toISOString(),
        });
      expect(created.status).toBe(201);
    }

    const seen = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      const response = await request(app())
        .get('/api/v1/delegations')
        .query({ limit: 2, ...(cursor ? { cursor } : {}) })
        .set('Cookie', from.cookie);
      expect(response.status).toBe(200);
      for (const row of response.body.data as Array<{ delegationId: string }>) {
        expect(seen.has(row.delegationId)).toBe(false);
        seen.add(row.delegationId);
      }
      if (!response.body.hasMore) {
        break;
      }
      cursor = response.body.nextCursor as string;
    }

    expect(seen.size).toBe(3);
  });
});
