import {
  createDb,
  createOrganisation,
  createUserWithIdentity,
  generateId,
  insertOrganisationMember,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import { createDummyEmailSender, type DummyEmailSender } from '@orgflow/email';
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

const SESSION_SECRET = '99'.repeat(32);

describe('invitations API against real Postgres', () => {
  let db: Kysely<Database>;
  let mongoClient: MongoClient;
  let organisationId: string;
  let adminCookie: string;
  let memberCookie: string;
  let publisher: DummyDomainEventPublisher;
  let emailSender: DummyEmailSender;

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
    return {
      userId: user.userId,
      email: user.email,
      cookie: await cookieFor(user.userId, roles, orgId),
    };
  }

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    mongoClient = await createMongoClient({ uri: process.env.ORGFLOW_TEST_MONGODB_URI! });

    const owner = await createUserWithIdentity(db, {
      email: `invitations-owner-${generateId()}@example.invalid`,
      displayName: 'Invitations Owner',
      issuer: 'urn:orgflow:test',
      subject: `invitations-owner-${generateId()}`,
    });
    const organisation = await createOrganisation(db, {
      name: 'Invitations tenant',
      slug: `invitations-tenant-${generateId()}`,
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

    const plain = await memberWithRoles('invitations-plain', ['member'], organisationId);
    memberCookie = plain.cookie;
  });

  afterAll(async () => {
    await db.destroy();
    await mongoClient.close();
  });

  beforeEach(() => {
    publisher = createDummyPublisher();
    emailSender = createDummyEmailSender();
  });

  function app() {
    return createApp({
      db,
      mongoClient,
      publisher,
      emailSender,
      fileStore: createDummyFileStore(),
      corsOrigin: 'http://localhost:3000',
      logger: createLogger('silent'),
      sessionSecret: SESSION_SECRET,
      isLocal: true,
      apiBaseUrl: 'http://localhost:4000',
    });
  }

  // Directly manipulates the row rather than waiting seven real days, the
  // same way expiry has to be tested anywhere it is measured against
  // creation time rather than a fixed clock the test controls.
  async function expireInvitation(invitationId: string): Promise<void> {
    await withTenantTransaction(db, organisationId, (trx) =>
      trx
        .updateTable('invitations')
        .set({ expires_at: new Date(Date.now() - 1000) })
        .where('invitation_id', '=', invitationId)
        .execute(),
    );
  }

  it('invites by email, sending a link and publishing member.invited', async () => {
    const email = `invitee-${generateId()}@example.invalid`;

    const response = await request(app())
      .post('/api/v1/invitations')
      .set('Cookie', adminCookie)
      .send({ email, roles: ['approver'] });

    expect(response.status).toBe(201);
    // 'member' is the floor every membership carries (ADR-0024), added even
    // though only 'approver' was requested.
    expect(response.body.invitation.roles).toEqual(['member', 'approver']);
    expect(response.body.inviteUrl).toContain('/invitations/');

    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0]!.to).toBe(email);

    expect(publisher.published.map((event) => event.eventType)).toContain('member.invited');
  });

  it('invites with no additional role, granting member alone', async () => {
    const email = `plain-member-${generateId()}@example.invalid`;

    const response = await request(app())
      .post('/api/v1/invitations')
      .set('Cookie', adminCookie)
      .send({ email, roles: [] });

    expect(response.status).toBe(201);
    expect(response.body.invitation.roles).toEqual(['member']);
  });

  it('refuses a second pending invitation to the same address', async () => {
    const email = `duplicate-${generateId()}@example.invalid`;

    const first = await request(app())
      .post('/api/v1/invitations')
      .set('Cookie', adminCookie)
      .send({ email, roles: ['member'] });
    expect(first.status).toBe(201);

    const second = await request(app())
      .post('/api/v1/invitations')
      .set('Cookie', adminCookie)
      .send({ email, roles: ['member'] });
    expect(second.status).toBe(409);
  });

  it('refuses to invite for a member without the admin role', async () => {
    const response = await request(app())
      .post('/api/v1/invitations')
      .set('Cookie', memberCookie)
      .send({ email: `nope-${generateId()}@example.invalid`, roles: ['member'] });

    expect(response.status).toBe(403);
  });

  it('lists pending invitations and revokes one', async () => {
    const email = `revoke-me-${generateId()}@example.invalid`;
    const created = await request(app())
      .post('/api/v1/invitations')
      .set('Cookie', adminCookie)
      .send({ email, roles: ['member'] });

    const listed = await request(app()).get('/api/v1/invitations').set('Cookie', adminCookie);
    expect(listed.status).toBe(200);
    expect(
      (listed.body.invitations as Array<{ email: string }>).some((row) => row.email === email),
    ).toBe(true);

    const revoked = await request(app())
      .delete(`/api/v1/invitations/${created.body.invitation.invitationId}`)
      .set('Cookie', adminCookie);
    expect(revoked.status).toBe(204);

    // A second revoke of the same, already-resolved invitation has nothing
    // left to do.
    const revokedAgain = await request(app())
      .delete(`/api/v1/invitations/${created.body.invitation.invitationId}`)
      .set('Cookie', adminCookie);
    expect(revokedAgain.status).toBe(404);
  });

  it('paginates invitations without repeating or skipping one across pages', async () => {
    const prefix = `page-test-${generateId()}`;
    const emails = [0, 1, 2].map((n) => `${prefix}-${n}@example.invalid`);
    for (const email of emails) {
      const created = await request(app())
        .post('/api/v1/invitations')
        .set('Cookie', adminCookie)
        .send({ email, roles: ['member'] });
      expect(created.status).toBe(201);
    }

    const first = await request(app())
      .get('/api/v1/invitations')
      .query({ query: prefix, limit: 2 })
      .set('Cookie', adminCookie);
    expect(first.status).toBe(200);
    expect(first.body.invitations).toHaveLength(2);
    expect(first.body.hasMore).toBe(true);

    const second = await request(app())
      .get('/api/v1/invitations')
      .query({ query: prefix, limit: 2, cursor: first.body.nextCursor })
      .set('Cookie', adminCookie);
    expect(second.status).toBe(200);
    expect(second.body.invitations).toHaveLength(1);
    expect(second.body.hasMore).toBe(false);

    const seenEmails = new Set([
      ...(first.body.invitations as Array<{ email: string }>).map((row) => row.email),
      ...(second.body.invitations as Array<{ email: string }>).map((row) => row.email),
    ]);
    expect(seenEmails).toEqual(new Set(emails));
  });

  it('filters invitations by a free-text query over email', async () => {
    const email = `findable-${generateId()}@example.invalid`;
    const created = await request(app())
      .post('/api/v1/invitations')
      .set('Cookie', adminCookie)
      .send({ email, roles: ['member'] });
    expect(created.status).toBe(201);

    const found = await request(app())
      .get('/api/v1/invitations')
      .query({ query: email })
      .set('Cookie', adminCookie);
    expect(found.status).toBe(200);
    expect(found.body.invitations).toHaveLength(1);
    expect(found.body.invitations[0].email).toBe(email);

    const notFound = await request(app())
      .get('/api/v1/invitations')
      .query({ query: `no-such-address-${generateId()}` })
      .set('Cookie', adminCookie);
    expect(notFound.status).toBe(200);
    expect(notFound.body.invitations).toHaveLength(0);
  });

  it('previews an invitation by token without requiring a session', async () => {
    const email = `preview-${generateId()}@example.invalid`;
    const created = await request(app())
      .post('/api/v1/invitations')
      .set('Cookie', adminCookie)
      .send({ email, roles: ['approver'] });

    const token = created.body.inviteUrl.split('/invitations/')[1] as string;

    // No Cookie set at all: this is the whole point of the route.
    const preview = await request(app()).get(`/api/v1/invitations/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body.invitation.email).toBe(email);
    expect(preview.body.invitation.status).toBe('pending');
    expect(preview.body.invitation.organisationName).toBe('Invitations tenant');
    // Nothing that would let a caller holding no token enumerate ids.
    expect(preview.body.invitation.invitationId).toBeUndefined();
    expect(preview.body.invitation.organisationId).toBeUndefined();
  });

  it('answers 404 for a token that does not exist', async () => {
    const response = await request(app()).get('/api/v1/invitations/not-a-real-token');
    expect(response.status).toBe(404);
  });

  it('reflects revoked and expired status in the preview', async () => {
    const revokedEmail = `preview-revoked-${generateId()}@example.invalid`;
    const revokedCreated = await request(app())
      .post('/api/v1/invitations')
      .set('Cookie', adminCookie)
      .send({ email: revokedEmail, roles: ['member'] });
    await request(app())
      .delete(`/api/v1/invitations/${revokedCreated.body.invitation.invitationId}`)
      .set('Cookie', adminCookie);
    const revokedToken = revokedCreated.body.inviteUrl.split('/invitations/')[1] as string;
    const revokedPreview = await request(app()).get(`/api/v1/invitations/${revokedToken}`);
    expect(revokedPreview.body.invitation.status).toBe('revoked');

    const expiredEmail = `preview-expired-${generateId()}@example.invalid`;
    const expiredCreated = await request(app())
      .post('/api/v1/invitations')
      .set('Cookie', adminCookie)
      .send({ email: expiredEmail, roles: ['member'] });
    await expireInvitation(expiredCreated.body.invitation.invitationId as string);
    const expiredToken = expiredCreated.body.inviteUrl.split('/invitations/')[1] as string;
    const expiredPreview = await request(app()).get(`/api/v1/invitations/${expiredToken}`);
    expect(expiredPreview.body.invitation.status).toBe('expired');
  });

  it('accepts an invitation for a brand-new user with no organisation yet', async () => {
    const email = `newcomer-${generateId()}@example.invalid`;
    const created = await request(app())
      .post('/api/v1/invitations')
      .set('Cookie', adminCookie)
      .send({ email, roles: ['approver'] });
    const token = created.body.inviteUrl.split('/invitations/')[1] as string;

    // The user this invitation is for exists (sign-in creates the user row
    // independently of any invitation), but holds no membership anywhere:
    // exactly PRD.md §12.1 step 7's zero-membership case, a session with
    // organisationId: null.
    const newcomer = await createUserWithIdentity(db, {
      email,
      displayName: 'Newcomer',
      issuer: 'urn:orgflow:test',
      subject: `newcomer-${generateId()}`,
    });
    const newcomerCookie = await cookieFor(newcomer.userId, [], null);

    const accepted = await request(app())
      .post(`/api/v1/invitations/${token}/accept`)
      .set('Cookie', newcomerCookie);

    expect(accepted.status).toBe(200);
    expect(accepted.body.organisationId).toBe(organisationId);
    // ADR-0010's rotation-on-privilege-change: the reissued cookie carries
    // the new organisation, not the null one the request arrived with.
    expect(accepted.headers['set-cookie']).toBeDefined();

    expect(publisher.published.map((event) => event.eventType)).toContain('member.joined');

    // A second acceptance of the same, now-resolved token has nothing left
    // to accept.
    const acceptedAgain = await request(app())
      .post(`/api/v1/invitations/${token}/accept`)
      .set('Cookie', newcomerCookie);
    expect(acceptedAgain.status).toBe(410);

    const preview = await request(app()).get(`/api/v1/invitations/${token}`);
    expect(preview.body.invitation.status).toBe('accepted');
  });

  it('refuses acceptance when the signed-in email does not match the invitation', async () => {
    const invitedEmail = `intended-${generateId()}@example.invalid`;
    const created = await request(app())
      .post('/api/v1/invitations')
      .set('Cookie', adminCookie)
      .send({ email: invitedEmail, roles: ['member'] });
    const token = created.body.inviteUrl.split('/invitations/')[1] as string;

    const someoneElse = await createUserWithIdentity(db, {
      email: `someone-else-${generateId()}@example.invalid`,
      displayName: 'Someone Else',
      issuer: 'urn:orgflow:test',
      subject: `someone-else-${generateId()}`,
    });
    const cookie = await cookieFor(someoneElse.userId, [], null);

    const response = await request(app())
      .post(`/api/v1/invitations/${token}/accept`)
      .set('Cookie', cookie);

    expect(response.status).toBe(403);
  });

  it('refuses acceptance with no session at all', async () => {
    const created = await request(app())
      .post('/api/v1/invitations')
      .set('Cookie', adminCookie)
      .send({ email: `anonymous-${generateId()}@example.invalid`, roles: ['member'] });
    const token = created.body.inviteUrl.split('/invitations/')[1] as string;

    const response = await request(app()).post(`/api/v1/invitations/${token}/accept`);
    expect(response.status).toBe(401);
  });

  it('rejects an expired invitation with a distinct reason from a missing one', async () => {
    const email = `expired-accept-${generateId()}@example.invalid`;
    const created = await request(app())
      .post('/api/v1/invitations')
      .set('Cookie', adminCookie)
      .send({ email, roles: ['member'] });
    await expireInvitation(created.body.invitation.invitationId as string);
    const token = created.body.inviteUrl.split('/invitations/')[1] as string;

    const user = await createUserWithIdentity(db, {
      email,
      displayName: 'Late Arrival',
      issuer: 'urn:orgflow:test',
      subject: `late-${generateId()}`,
    });
    const cookie = await cookieFor(user.userId, [], null);

    const response = await request(app())
      .post(`/api/v1/invitations/${token}/accept`)
      .set('Cookie', cookie);

    expect(response.status).toBe(410);
  });

  it('reactivates a removed member with the roles the new invitation grants', async () => {
    const removable = await memberWithRoles('invitations-reactivated', ['member'], organisationId);
    await request(app()).delete(`/api/v1/members/${removable.userId}`).set('Cookie', adminCookie);

    const created = await request(app())
      .post('/api/v1/invitations')
      .set('Cookie', adminCookie)
      .send({ email: removable.email, roles: ['processOwner'] });
    const token = created.body.inviteUrl.split('/invitations/')[1] as string;

    const cookie = await cookieFor(removable.userId, ['member'], organisationId);
    const accepted = await request(app())
      .post(`/api/v1/invitations/${token}/accept`)
      .set('Cookie', cookie);

    expect(accepted.status).toBe(200);

    const listed = await request(app()).get('/api/v1/members').set('Cookie', adminCookie);
    const row = (
      listed.body.members as Array<{ userId: string; status: string; roles: string[] }>
    ).find((m) => m.userId === removable.userId);
    expect(row?.status).toBe('active');
    expect(row?.roles).toEqual(['member', 'processOwner']);
  });
});
