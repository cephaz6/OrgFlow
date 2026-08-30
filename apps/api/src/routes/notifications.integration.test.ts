import {
  buildIdempotencyKey,
  claimNotification,
  createDb,
  createOrganisation,
  createUserWithIdentity,
  generateId,
  insertOrganisationMember,
  markNotificationSent,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import { createMongoClient } from '@orgflow/documents';
import { createDummyEmailSender } from '@orgflow/email';
import { createDummyFileStore } from '@orgflow/storage';
import { createDummyPublisher } from '@orgflow/events';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { buildSessionClaims, createSessionToken, SESSION_COOKIE_NAME } from '../auth/session.js';
import { createLogger } from '../logger.js';

const SESSION_SECRET = '22'.repeat(32);

describe('notifications API against real Postgres', () => {
  let db: Kysely<Database>;
  let mongoClient: MongoClient;
  let organisationId: string;
  let userId: string;
  let userCookie: string;
  let otherUserId: string;
  let otherCookie: string;

  async function seedInApp(recipientUserId: string, templateKey: string) {
    return withTenantTransaction(db, organisationId, async (trx) => {
      const claimed = await claimNotification(trx, {
        organisationId,
        recipientUserId,
        channel: 'inApp',
        templateKey,
        subject: `Subject for ${templateKey}`,
        idempotencyKey: buildIdempotencyKey({
          eventId: `event-${generateId()}`,
          recipientUserId,
          templateKey,
          channel: 'inApp',
        }),
      });
      if (claimed.outcome === 'claimed') {
        await markNotificationSent(trx, claimed.notification.notificationId);
      }
      return claimed.notification;
    });
  }

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    mongoClient = await createMongoClient({ uri: process.env.ORGFLOW_TEST_MONGODB_URI! });

    const user = await createUserWithIdentity(db, {
      email: `notif-user-${generateId()}@example.invalid`,
      displayName: 'Notif User',
      issuer: 'urn:orgflow:test',
      subject: `notif-user-${generateId()}`,
    });
    userId = user.userId;

    const organisation = await createOrganisation(db, {
      name: 'Notifications tenant',
      slug: `notif-tenant-${generateId()}`,
      createdByUserId: userId,
    });
    organisationId = organisation.organisationId;

    await withTenantTransaction(db, organisationId, (trx) =>
      insertOrganisationMember(trx, { organisationId, userId, roles: ['member'] }),
    );
    userCookie = `${SESSION_COOKIE_NAME}=${await createSessionToken(
      SESSION_SECRET,
      buildSessionClaims(userId, organisationId, ['member']),
    )}`;

    const other = await createUserWithIdentity(db, {
      email: `notif-other-${generateId()}@example.invalid`,
      displayName: 'Notif Other',
      issuer: 'urn:orgflow:test',
      subject: `notif-other-${generateId()}`,
    });
    otherUserId = other.userId;
    await withTenantTransaction(db, organisationId, (trx) =>
      insertOrganisationMember(trx, { organisationId, userId: otherUserId, roles: ['member'] }),
    );
    otherCookie = `${SESSION_COOKIE_NAME}=${await createSessionToken(
      SESSION_SECRET,
      buildSessionClaims(otherUserId, organisationId, ['member']),
    )}`;
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

  it("lists only the caller's own notifications, most recent first", async () => {
    await seedInApp(userId, 'taskAssigned');
    await seedInApp(userId, 'taskEscalated');
    await seedInApp(otherUserId, 'taskAssigned');

    const response = await request(app()).get('/api/v1/notifications').set('Cookie', userCookie);

    expect(response.status).toBe(200);
    const templateKeys = response.body.data.map((n: { templateKey: string }) => n.templateKey);
    expect(templateKeys).toEqual(['taskEscalated', 'taskAssigned']);
  });

  it('counts only unread notifications', async () => {
    const before = await request(app())
      .get('/api/v1/notifications/unread-count')
      .set('Cookie', userCookie);
    const baseline = before.body.count as number;

    await seedInApp(userId, 'taskReminder');

    const after = await request(app())
      .get('/api/v1/notifications/unread-count')
      .set('Cookie', userCookie);
    expect(after.body.count).toBe(baseline + 1);
  });

  it('marks one notification read, excluding it from an unreadOnly list', async () => {
    const created = await seedInApp(userId, 'caseUnassigned');

    const unreadBefore = await request(app())
      .get('/api/v1/notifications')
      .query({ unreadOnly: 'true' })
      .set('Cookie', userCookie);
    expect(
      unreadBefore.body.data.map((n: { notificationId: string }) => n.notificationId),
    ).toContain(created.notificationId);

    const marked = await request(app())
      .post(`/api/v1/notifications/${created.notificationId}/read`)
      .set('Cookie', userCookie);
    expect(marked.status).toBe(204);

    const unreadAfter = await request(app())
      .get('/api/v1/notifications')
      .query({ unreadOnly: 'true' })
      .set('Cookie', userCookie);
    expect(
      unreadAfter.body.data.map((n: { notificationId: string }) => n.notificationId),
    ).not.toContain(created.notificationId);
  });

  it("cannot mark another user's notification read", async () => {
    const created = await seedInApp(otherUserId, 'taskAssigned');

    await request(app())
      .post(`/api/v1/notifications/${created.notificationId}/read`)
      .set('Cookie', userCookie);

    const asOwner = await request(app())
      .get('/api/v1/notifications')
      .query({ unreadOnly: 'true' })
      .set('Cookie', otherCookie);
    expect(asOwner.body.data.map((n: { notificationId: string }) => n.notificationId)).toContain(
      created.notificationId,
    );
  });

  it('marks every notification read at once', async () => {
    await seedInApp(userId, 'taskAssigned');
    await seedInApp(userId, 'taskEscalated');

    const response = await request(app())
      .post('/api/v1/notifications/read-all')
      .set('Cookie', userCookie);
    expect(response.status).toBe(204);

    const unreadAfter = await request(app())
      .get('/api/v1/notifications')
      .query({ unreadOnly: 'true' })
      .set('Cookie', userCookie);
    expect(unreadAfter.body.data).toEqual([]);
  });

  it('requires a session', async () => {
    const response = await request(app()).get('/api/v1/notifications');
    expect(response.status).toBe(401);
  });
});
