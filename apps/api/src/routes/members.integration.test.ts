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

const SESSION_SECRET = '77'.repeat(32);

describe('members API against real Postgres', () => {
  let db: Kysely<Database>;
  let mongoClient: MongoClient;
  let organisationId: string;
  let ownerUserId: string;
  let ownerCookie: string;
  let adminCookie: string;
  let adminUserId: string;
  let memberCookie: string;
  let plainUserId: string;
  let secondOwnerUserId: string;

  // A second organisation, so the isolation test asserts against a member
  // who genuinely exists rather than against a fabricated identifier that
  // would 404 for the boring reason.
  let otherOrganisationId: string;
  let otherTenantUserId: string;
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
      email: `members-owner-${generateId()}@example.invalid`,
      displayName: 'Members Owner',
      issuer: 'urn:orgflow:test',
      subject: `members-owner-${generateId()}`,
    });
    const organisation = await createOrganisation(db, {
      name: 'Members tenant',
      slug: `members-tenant-${generateId()}`,
      createdByUserId: owner.userId,
    });
    organisationId = organisation.organisationId;
    ownerUserId = owner.userId;

    await withTenantTransaction(db, organisationId, (trx) =>
      insertOrganisationMember(trx, {
        organisationId,
        userId: owner.userId,
        roles: ['owner', 'admin', 'member'],
      }),
    );
    ownerCookie = await cookieFor(owner.userId, ['owner', 'admin', 'member'], organisationId);

    const admin = await memberWithRoles('members-admin', ['admin', 'member'], organisationId);
    adminCookie = admin.cookie;
    adminUserId = admin.userId;

    const plain = await memberWithRoles('members-plain', ['member'], organisationId);
    memberCookie = plain.cookie;
    plainUserId = plain.userId;

    const secondOwner = await memberWithRoles(
      'members-second-owner',
      ['owner', 'member'],
      organisationId,
    );
    secondOwnerUserId = secondOwner.userId;

    const otherOwner = await createUserWithIdentity(db, {
      email: `other-owner-${generateId()}@example.invalid`,
      displayName: 'Other Owner',
      issuer: 'urn:orgflow:test',
      subject: `other-owner-${generateId()}`,
    });
    const otherOrganisation = await createOrganisation(db, {
      name: 'Other tenant',
      slug: `other-tenant-${generateId()}`,
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
    otherTenantUserId = otherOwner.userId;
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

  it('lists the directory for an admin, with identity joined on', async () => {
    const response = await request(app()).get('/api/v1/members').set('Cookie', adminCookie);

    expect(response.status).toBe(200);
    const listed = response.body.members as Array<{ userId: string; displayName: string }>;
    expect(listed.map((m) => m.userId)).toContain(plainUserId);
    // The join, not just the membership row: a directory screen cannot show
    // a member without a name.
    expect(listed.find((m) => m.userId === plainUserId)?.displayName).toBe('members-plain');
  });

  it('refuses the directory to a member without the admin role', async () => {
    const response = await request(app()).get('/api/v1/members').set('Cookie', memberCookie);

    // 403 rather than 404: /members is not a tenant secret, only the data
    // behind it is role-gated, matching how approver load already answers.
    expect(response.status).toBe(403);
  });

  it('paginates the directory without repeating or skipping a member across pages', async () => {
    const first = await request(app())
      .get('/api/v1/members')
      .query({ limit: 2 })
      .set('Cookie', adminCookie);

    expect(first.status).toBe(200);
    expect(first.body.members).toHaveLength(2);
    expect(first.body.hasMore).toBe(true);
    expect(typeof first.body.nextCursor).toBe('string');

    const seen = new Set(first.body.members.map((m: { userId: string }) => m.userId));
    let cursor = first.body.nextCursor as string;
    let hasMore = true;

    while (hasMore) {
      const next = await request(app())
        .get('/api/v1/members')
        .query({ limit: 2, cursor })
        .set('Cookie', adminCookie);

      expect(next.status).toBe(200);
      for (const member of next.body.members as Array<{ userId: string }>) {
        expect(seen.has(member.userId)).toBe(false);
        seen.add(member.userId);
      }
      hasMore = next.body.hasMore as boolean;
      cursor = next.body.nextCursor as string;
    }

    expect(seen.has(plainUserId)).toBe(true);
    expect(seen.has(adminUserId)).toBe(true);
    expect(seen.has(ownerUserId)).toBe(true);
    expect(seen.has(secondOwnerUserId)).toBe(true);
  });

  it('does not skip or repeat a member when two share the exact same display name', async () => {
    // The directory orders by display name, not by id (unlike cases.ts's
    // cursor), so the cursor is a composite of (name, id): this proves the
    // id half of that composite actually breaks the tie, rather than the
    // second same-named row being silently dropped or duplicated.
    const sharedName = `Duplicate Name ${generateId()}`;
    const twins = await Promise.all(
      [0, 1].map(async () => {
        const user = await createUserWithIdentity(db, {
          email: `twin-${generateId()}@example.invalid`,
          displayName: sharedName,
          issuer: 'urn:orgflow:test',
          subject: `twin-${generateId()}`,
        });
        await withTenantTransaction(db, organisationId, (trx) =>
          insertOrganisationMember(trx, {
            organisationId,
            userId: user.userId,
            roles: ['member'],
          }),
        );
        return user.userId;
      }),
    );

    const first = await request(app())
      .get('/api/v1/members')
      .query({ query: sharedName, limit: 1 })
      .set('Cookie', adminCookie);
    expect(first.status).toBe(200);
    expect(first.body.members).toHaveLength(1);
    expect(first.body.hasMore).toBe(true);

    const second = await request(app())
      .get('/api/v1/members')
      .query({ query: sharedName, limit: 1, cursor: first.body.nextCursor })
      .set('Cookie', adminCookie);
    expect(second.status).toBe(200);
    expect(second.body.members).toHaveLength(1);
    expect(second.body.hasMore).toBe(false);

    const seenIds = [first.body.members[0].userId, second.body.members[0].userId];
    expect(new Set(seenIds)).toEqual(new Set(twins));
  });

  it('filters the directory by a free-text query over name or email', async () => {
    const response = await request(app())
      .get('/api/v1/members')
      .query({ query: 'members-plain' })
      .set('Cookie', adminCookie);

    expect(response.status).toBe(200);
    const listed = response.body.members as Array<{ userId: string }>;
    expect(listed.map((m) => m.userId)).toEqual([plainUserId]);
    expect(response.body.hasMore).toBe(false);
  });

  it('filters by role and by free text', async () => {
    const byRole = await request(app())
      .get('/api/v1/members?role=owner')
      .set('Cookie', ownerCookie);
    expect(byRole.status).toBe(200);
    const ownerIds = (byRole.body.members as Array<{ userId: string }>).map((m) => m.userId);
    expect(ownerIds).toContain(ownerUserId);
    expect(ownerIds).not.toContain(plainUserId);

    const byText = await request(app())
      .get('/api/v1/members?query=members-plain')
      .set('Cookie', ownerCookie);
    expect(byText.status).toBe(200);
    expect((byText.body.members as unknown[]).length).toBe(1);
  });

  it('updates roles, department and line manager', async () => {
    const response = await request(app())
      .patch(`/api/v1/members/${plainUserId}`)
      .set('Cookie', adminCookie)
      .send({
        roles: ['member', 'approver'],
        department: 'Finance',
        lineManagerUserId: ownerUserId,
      });

    expect(response.status).toBe(200);
    expect(response.body.roles).toEqual(['member', 'approver']);
    expect(response.body.department).toBe('Finance');
    // The response carries the manager's name, not only the identifier, so
    // the screen does not need a second request to render the row it just
    // changed.
    expect(response.body.lineManagerName).toBe('Members Owner');
  });

  it('refuses an empty patch rather than silently touching the row', async () => {
    const response = await request(app())
      .patch(`/api/v1/members/${plainUserId}`)
      .set('Cookie', adminCookie)
      .send({});

    expect(response.status).toBe(400);
  });

  it('will not let an administrator change their own roles', async () => {
    const response = await request(app())
      .patch(`/api/v1/members/${adminUserId}`)
      .set('Cookie', adminCookie)
      .send({ roles: ['member'] });

    expect(response.status).toBe(403);
  });

  it('will not let an administrator remove themselves', async () => {
    const response = await request(app())
      .delete(`/api/v1/members/${adminUserId}`)
      .set('Cookie', adminCookie);

    expect(response.status).toBe(403);
  });

  it('removes a member by suspending the row rather than deleting it', async () => {
    const target = await memberWithRoles('members-removable', ['member'], organisationId);

    const removal = await request(app())
      .delete(`/api/v1/members/${target.userId}`)
      .set('Cookie', adminCookie);
    expect(removal.status).toBe(204);

    // The row survives, which is what keeps the audit trail and every case
    // that references this user readable.
    const listed = await request(app())
      .get('/api/v1/members?status=removed')
      .set('Cookie', adminCookie);
    expect(
      (listed.body.members as Array<{ userId: string; status: string }>).find(
        (m) => m.userId === target.userId,
      )?.status,
    ).toBe('removed');
  });

  it('keeps at least one active owner', async () => {
    // Two owners exist at this point, so demoting one is allowed.
    const first = await request(app())
      .patch(`/api/v1/members/${secondOwnerUserId}`)
      .set('Cookie', ownerCookie)
      .send({ roles: ['member'] });
    expect(first.status).toBe(200);

    // The signed-in owner is now the only one left. Another admin trying to
    // demote them would strand the organisation, so it is refused.
    const second = await request(app())
      .patch(`/api/v1/members/${ownerUserId}`)
      .set('Cookie', adminCookie)
      .send({ roles: ['admin', 'member'] });
    expect(second.status).toBe(409);

    const removal = await request(app())
      .delete(`/api/v1/members/${ownerUserId}`)
      .set('Cookie', adminCookie);
    expect(removal.status).toBe(409);
  });

  it('does not reach across tenants, and says 404 rather than 403', async () => {
    // A real member of another organisation, read with this organisation's
    // session. PRD.md §11.10: a 403 would confirm the user exists.
    const patched = await request(app())
      .patch(`/api/v1/members/${otherTenantUserId}`)
      .set('Cookie', ownerCookie)
      .send({ department: 'Nowhere' });
    expect(patched.status).toBe(404);

    const removed = await request(app())
      .delete(`/api/v1/members/${otherTenantUserId}`)
      .set('Cookie', ownerCookie);
    expect(removed.status).toBe(404);

    // And the directory never shows them at all.
    const listed = await request(app()).get('/api/v1/members').set('Cookie', ownerCookie);
    expect((listed.body.members as Array<{ userId: string }>).map((m) => m.userId)).not.toContain(
      otherTenantUserId,
    );

    // The reverse direction too, so this is isolation rather than one
    // organisation happening to be empty.
    const reverse = await request(app())
      .patch(`/api/v1/members/${plainUserId}`)
      .set('Cookie', otherTenantCookie)
      .send({ department: 'Nowhere' });
    expect(reverse.status).toBe(404);
  });
});
