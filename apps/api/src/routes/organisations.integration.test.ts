import {
  createDb,
  createOrganisation,
  createUserWithIdentity,
  ensurePlatformAdmin,
  findOrganisationMemberByUserId,
  generateId,
  insertOrganisationMember,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import { createDummyEmailSender } from '@orgflow/email';
import { createDummyFileStore } from '@orgflow/storage';
import { createMongoClient } from '@orgflow/documents';
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

describe('organisations API against real Postgres', () => {
  let db: Kysely<Database>;
  let mongoClient: MongoClient;
  let publisher: DummyDomainEventPublisher;

  async function cookieFor(
    userId: string,
    roles: OrganisationRole[],
    orgId: string | null,
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
  });

  afterAll(async () => {
    await db.destroy();
    await mongoClient.close();
  });

  beforeEach(() => {
    publisher = createDummyPublisher();
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

  it('lets a platform admin create an organisation, becoming its owner', async () => {
    const admin = await createUserWithIdentity(db, {
      email: `platform-admin-${generateId()}@example.invalid`,
      displayName: 'Platform Admin',
      issuer: 'urn:orgflow:test',
      subject: `platform-admin-${generateId()}`,
    });
    await ensurePlatformAdmin(db, admin.userId);
    // organisationId: null, the same zero-membership session shape sign-in
    // produces before any organisation has been chosen (PRD.md §12.1 step
    // 7) or created.
    const cookie = await cookieFor(admin.userId, [], null);

    const response = await request(app())
      .post('/api/v1/organisations')
      .set('Cookie', cookie)
      .send({ name: `DWP Digital ${generateId()}` });

    expect(response.status).toBe(201);
    const organisationId = response.body.organisation.organisationId as string;
    expect(response.body.organisation.slug).toMatch(/^dwp-digital-/);

    // ADR-0010's rotation-on-privilege-change: the reissued cookie carries
    // the new organisation, not the null one the request arrived with.
    expect(response.headers['set-cookie']).toBeDefined();

    const membership = await withTenantTransaction(db, organisationId, (trx) =>
      findOrganisationMemberByUserId(trx, admin.userId),
    );
    expect(membership?.roles).toEqual(
      expect.arrayContaining(['owner', 'admin', 'processOwner', 'approver', 'member']),
    );

    expect(publisher.published.map((event) => event.eventType)).toContain('organisation.created');
  });

  it('refuses creation for a signed-in user who is not a platform admin', async () => {
    const plain = await createUserWithIdentity(db, {
      email: `not-platform-admin-${generateId()}@example.invalid`,
      displayName: 'Not Platform Admin',
      issuer: 'urn:orgflow:test',
      subject: `not-platform-admin-${generateId()}`,
    });
    const cookie = await cookieFor(plain.userId, [], null);

    const response = await request(app())
      .post('/api/v1/organisations')
      .set('Cookie', cookie)
      .send({ name: 'Should not exist' });

    expect(response.status).toBe(403);
  });

  it('refuses creation with no session at all', async () => {
    const response = await request(app())
      .post('/api/v1/organisations')
      .send({ name: 'Should not exist' });

    expect(response.status).toBe(401);
  });

  it('refuses a second organisation whose name derives the same slug', async () => {
    const admin = await createUserWithIdentity(db, {
      email: `platform-admin-dup-${generateId()}@example.invalid`,
      displayName: 'Platform Admin',
      issuer: 'urn:orgflow:test',
      subject: `platform-admin-dup-${generateId()}`,
    });
    await ensurePlatformAdmin(db, admin.userId);
    const cookie = await cookieFor(admin.userId, [], null);

    const name = `Unique Name ${generateId()}`;
    const first = await request(app())
      .post('/api/v1/organisations')
      .set('Cookie', cookie)
      .send({ name });
    expect(first.status).toBe(201);

    const second = await request(app())
      .post('/api/v1/organisations')
      .set('Cookie', cookie)
      .send({ name });
    expect(second.status).toBe(409);
  });

  it('reads and updates the current organisation, gated to the owner role', async () => {
    const owner = await createUserWithIdentity(db, {
      email: `org-owner-${generateId()}@example.invalid`,
      displayName: 'Org Owner',
      issuer: 'urn:orgflow:test',
      subject: `org-owner-${generateId()}`,
    });
    const organisation = await createOrganisation(db, {
      name: 'Settings Tenant',
      slug: `settings-tenant-${generateId()}`,
      createdByUserId: owner.userId,
    });
    await withTenantTransaction(db, organisation.organisationId, (trx) =>
      insertOrganisationMember(trx, {
        organisationId: organisation.organisationId,
        userId: owner.userId,
        roles: ['owner', 'admin', 'member'],
      }),
    );
    const ownerCookie = await cookieFor(
      owner.userId,
      ['owner', 'admin', 'member'],
      organisation.organisationId,
    );

    const admin = await createUserWithIdentity(db, {
      email: `org-admin-${generateId()}@example.invalid`,
      displayName: 'Org Admin',
      issuer: 'urn:orgflow:test',
      subject: `org-admin-${generateId()}`,
    });
    await withTenantTransaction(db, organisation.organisationId, (trx) =>
      insertOrganisationMember(trx, {
        organisationId: organisation.organisationId,
        userId: admin.userId,
        roles: ['admin', 'member'],
      }),
    );
    const adminCookie = await cookieFor(
      admin.userId,
      ['admin', 'member'],
      organisation.organisationId,
    );

    const read = await request(app())
      .get('/api/v1/organisations/current')
      .set('Cookie', ownerCookie);
    expect(read.status).toBe(200);
    expect(read.body.organisation.name).toBe('Settings Tenant');

    // admin holds "manage members", not "manage organisation settings"
    // (PRD.md §12.2), so the update is refused even though the read above
    // was not gated at all beyond ordinary membership.
    const refused = await request(app())
      .patch('/api/v1/organisations/current')
      .set('Cookie', adminCookie)
      .send({ name: 'Renamed By Admin' });
    expect(refused.status).toBe(403);

    const updated = await request(app())
      .patch('/api/v1/organisations/current')
      .set('Cookie', ownerCookie)
      .send({ name: 'Renamed By Owner' });
    expect(updated.status).toBe(200);
    expect(updated.body.organisation.name).toBe('Renamed By Owner');
  });
});
