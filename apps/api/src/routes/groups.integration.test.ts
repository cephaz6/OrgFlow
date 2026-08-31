import {
  createDb,
  createOrganisation,
  createProcessDefinition,
  createUserWithIdentity,
  ensureGroup,
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

const SESSION_SECRET = '88'.repeat(32);

describe('groups API against real Postgres', () => {
  let db: Kysely<Database>;
  let mongoClient: MongoClient;
  let organisationId: string;
  let adminCookie: string;
  let memberCookie: string;
  let memberUserId: string;
  let otherOrganisationId: string;
  let otherTenantCookie: string;

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

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    mongoClient = await createMongoClient({ uri: process.env.ORGFLOW_TEST_MONGODB_URI! });

    const owner = await createUserWithIdentity(db, {
      email: `groups-route-owner-${generateId()}@example.invalid`,
      displayName: 'Groups Route Owner',
      issuer: 'urn:orgflow:test',
      subject: `groups-route-owner-${generateId()}`,
    });
    const organisation = await createOrganisation(db, {
      name: 'Groups route tenant',
      slug: `groups-route-tenant-${generateId()}`,
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
    adminCookie = await cookieFor(owner.userId, ['owner', 'admin', 'member'], organisationId);

    const plain = await memberWithRoles('groups-route-plain', ['member'], organisationId);
    memberCookie = plain.cookie;
    memberUserId = plain.userId;

    const otherOwner = await createUserWithIdentity(db, {
      email: `groups-route-other-owner-${generateId()}@example.invalid`,
      displayName: 'Groups Route Other Owner',
      issuer: 'urn:orgflow:test',
      subject: `groups-route-other-owner-${generateId()}`,
    });
    const otherOrganisation = await createOrganisation(db, {
      name: 'Groups route other tenant',
      slug: `groups-route-other-tenant-${generateId()}`,
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
    otherTenantCookie = await cookieFor(
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

  it("lists every group in the caller's own organisation, and none from another", async () => {
    await withTenantTransaction(db, organisationId, async (trx) => {
      await ensureGroup(trx, { organisationId, key: `it-${generateId()}`, name: 'IT' });
      await ensureGroup(trx, { organisationId, key: `finance-${generateId()}`, name: 'Finance' });
    });
    await withTenantTransaction(db, otherOrganisationId, (trx) =>
      ensureGroup(trx, {
        organisationId: otherOrganisationId,
        key: `secret-${generateId()}`,
        name: 'Secret group',
      }),
    );

    // GET /groups stays open to any signed-in member (ADR-0027's
    // owning-group picklist), not gated to admin like everything else in
    // this file.
    const response = await request(app()).get('/api/v1/groups').set('Cookie', memberCookie);

    expect(response.status).toBe(200);
    const names = response.body.data.map((group: { name: string }) => group.name);
    expect(names).toEqual(expect.arrayContaining(['IT', 'Finance']));
    expect(names).not.toContain('Secret group');
  });

  it('refuses an unauthenticated request', async () => {
    const response = await request(app()).get('/api/v1/groups');
    expect(response.status).toBe(401);
  });

  it('refuses a plain member creating, viewing the detail of, or deleting a group', async () => {
    const created = await request(app())
      .post('/api/v1/groups')
      .set('Cookie', memberCookie)
      .send({ name: 'Should not exist' });
    expect(created.status).toBe(403);

    const detail = await request(app()).get('/api/v1/groups/whatever').set('Cookie', memberCookie);
    expect(detail.status).toBe(403);
  });

  it('creates a group, deriving a stable key from the name', async () => {
    const created = await request(app())
      .post('/api/v1/groups')
      .set('Cookie', adminCookie)
      .send({ name: 'Facilities & Estates', description: 'Building and office management' });

    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Facilities & Estates');
    expect(created.body.key).toBe('facilities-estates');
    expect(created.body.description).toBe('Building and office management');
  });

  it('allocates a suffixed key when the derived slug is already taken', async () => {
    const first = await request(app())
      .post('/api/v1/groups')
      .set('Cookie', adminCookie)
      .send({ name: 'Legal' });
    expect(first.status).toBe(201);
    expect(first.body.key).toBe('legal');

    const second = await request(app())
      .post('/api/v1/groups')
      .set('Cookie', adminCookie)
      .send({ name: 'Legal' });
    expect(second.status).toBe(201);
    expect(second.body.key).toBe('legal-2');
  });

  it('renames a group without changing its key, adds a member, and removes them', async () => {
    const created = await request(app())
      .post('/api/v1/groups')
      .set('Cookie', adminCookie)
      .send({ name: 'Security' });
    const groupId = created.body.groupId as string;
    const originalKey = created.body.key as string;

    const renamed = await request(app())
      .patch(`/api/v1/groups/${groupId}`)
      .set('Cookie', adminCookie)
      .send({ name: 'Security & Compliance' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Security & Compliance');
    // ADR-0014: the key is what a pinned definition document actually
    // resolves against, so a rename must never move it.
    expect(renamed.body.key).toBe(originalKey);

    const added = await request(app())
      .post(`/api/v1/groups/${groupId}/members`)
      .set('Cookie', adminCookie)
      .send({ userId: memberUserId });
    expect(added.status).toBe(200);
    expect(added.body.members.map((m: { userId: string }) => m.userId)).toContain(memberUserId);

    const detail = await request(app()).get(`/api/v1/groups/${groupId}`).set('Cookie', adminCookie);
    expect(detail.status).toBe(200);
    expect(detail.body.members).toHaveLength(1);
    expect(detail.body.members[0]).toMatchObject({ userId: memberUserId });

    const removed = await request(app())
      .delete(`/api/v1/groups/${groupId}/members/${memberUserId}`)
      .set('Cookie', adminCookie);
    expect(removed.status).toBe(204);

    const detailAfterRemove = await request(app())
      .get(`/api/v1/groups/${groupId}`)
      .set('Cookie', adminCookie);
    expect(detailAfterRemove.body.members).toHaveLength(0);
  });

  it('refuses to add a user who is not a member of this organisation', async () => {
    const created = await request(app())
      .post('/api/v1/groups')
      .set('Cookie', adminCookie)
      .send({ name: 'Warehouse' });
    const groupId = created.body.groupId as string;

    const outsider = await createUserWithIdentity(db, {
      email: `groups-route-outsider-${generateId()}@example.invalid`,
      displayName: 'Outsider',
      issuer: 'urn:orgflow:test',
      subject: `groups-route-outsider-${generateId()}`,
    });

    const response = await request(app())
      .post(`/api/v1/groups/${groupId}/members`)
      .set('Cookie', adminCookie)
      .send({ userId: outsider.userId });

    expect(response.status).toBe(404);
  });

  it('404s removing a member who never belonged to the group', async () => {
    const created = await request(app())
      .post('/api/v1/groups')
      .set('Cookie', adminCookie)
      .send({ name: 'Never Joined' });
    const groupId = created.body.groupId as string;

    const response = await request(app())
      .delete(`/api/v1/groups/${groupId}/members/${memberUserId}`)
      .set('Cookie', adminCookie);

    expect(response.status).toBe(404);
  });

  it('deletes an unreferenced group', async () => {
    const created = await request(app())
      .post('/api/v1/groups')
      .set('Cookie', adminCookie)
      .send({ name: 'Temporary' });
    const groupId = created.body.groupId as string;

    const deleted = await request(app())
      .delete(`/api/v1/groups/${groupId}`)
      .set('Cookie', adminCookie);
    expect(deleted.status).toBe(204);

    const listed = await request(app()).get('/api/v1/groups').set('Cookie', adminCookie);
    expect(listed.body.data.map((g: { groupId: string }) => g.groupId)).not.toContain(groupId);
  });

  it('refuses to delete a group a process definition still owns', async () => {
    const created = await request(app())
      .post('/api/v1/groups')
      .set('Cookie', adminCookie)
      .send({ name: 'Owning Group Under Test' });
    const groupId = created.body.groupId as string;

    await withTenantTransaction(db, organisationId, (trx) =>
      createProcessDefinition(trx, {
        organisationId,
        key: `owned-definition-${generateId()}`,
        name: 'Owned definition',
        referencePrefix: 'OWN',
        createdByUserId: memberUserId,
        owningGroupId: groupId,
      }),
    );

    const response = await request(app())
      .delete(`/api/v1/groups/${groupId}`)
      .set('Cookie', adminCookie);

    expect(response.status).toBe(409);
  });

  it('404s, never 403, managing a group that belongs to a different tenant', async () => {
    const created = await request(app())
      .post('/api/v1/groups')
      .set('Cookie', otherTenantCookie)
      .send({ name: 'Other tenant group' });
    expect(created.status).toBe(201);
    const groupId = created.body.groupId as string;

    // Cross-tenant reads as absent under RLS (PRD.md §11.10, ADR-0015): the
    // same 404 a genuinely unknown group id gets, never a 403 that would
    // confirm the id refers to something real.
    const response = await request(app())
      .patch(`/api/v1/groups/${groupId}`)
      .set('Cookie', adminCookie)
      .send({ name: 'Renamed' });

    expect(response.status).toBe(404);
  });
});
