import {
  addHoliday,
  createDb,
  createOrganisation,
  createUserWithIdentity,
  generateId,
  insertOrganisationMember,
  upsertOrganisationCalendar,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import { createMongoClient } from '@orgflow/documents';
import { createDummyEmailSender } from '@orgflow/email';
import { createDummyPublisher } from '@orgflow/events';
import { createDummyFileStore } from '@orgflow/storage';
import type { OrganisationRole } from '@orgflow/types';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { buildSessionClaims, createSessionToken, SESSION_COOKIE_NAME } from '../auth/session.js';
import { buildEvaluationContext } from '../cases/evaluation-context.js';
import { createLogger } from '../logger.js';

const SESSION_SECRET = 'aa'.repeat(32);

describe('the working calendar API against real Postgres', () => {
  let db: Kysely<Database>;
  let mongoClient: MongoClient;
  let organisationId: string;
  let adminCookie: string;
  let memberCookie: string;
  let memberUserId: string;

  async function cookieFor(userId: string, roles: OrganisationRole[], orgId: string) {
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
      email: `cal-owner-${generateId()}@example.invalid`,
      displayName: 'Calendar owner',
      issuer: 'urn:orgflow:test',
      subject: `cal-owner-${generateId()}`,
    });
    const organisation = await createOrganisation(db, {
      name: 'Calendar tenant',
      slug: `cal-tenant-${generateId()}`,
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

    const plain = await createUserWithIdentity(db, {
      email: `cal-member-${generateId()}@example.invalid`,
      displayName: 'Calendar member',
      issuer: 'urn:orgflow:test',
      subject: `cal-member-${generateId()}`,
    });
    memberUserId = plain.userId;
    await withTenantTransaction(db, organisationId, (trx) =>
      insertOrganisationMember(trx, { organisationId, userId: plain.userId, roles: ['member'] }),
    );
    memberCookie = await cookieFor(plain.userId, ['member'], organisationId);
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

  it('reports the engine default, flagged as not yet configured', async () => {
    const response = await request(app())
      .get('/api/v1/working-calendar')
      .set('Cookie', memberCookie)
      .expect(200);

    expect(response.body.isDefault).toBe(true);
    expect(response.body.calendar.timeZone).toBe('UTC');
    expect(response.body.calendar.workdays).toEqual([1, 2, 3, 4, 5]);
  });

  it('lets an administrator set it, and any member read it back', async () => {
    await request(app())
      .put('/api/v1/working-calendar')
      .set('Cookie', adminCookie)
      .send({
        timeZone: 'Europe/London',
        workdays: [1, 2, 3, 4, 5],
        startMinute: 540,
        endMinute: 1020,
      })
      .expect(204);

    const response = await request(app())
      .get('/api/v1/working-calendar')
      .set('Cookie', memberCookie)
      .expect(200);

    expect(response.body.isDefault).toBe(false);
    expect(response.body.calendar.timeZone).toBe('Europe/London');
  });

  it('refuses a working day that ends before it starts', async () => {
    await request(app())
      .put('/api/v1/working-calendar')
      .set('Cookie', adminCookie)
      .send({ timeZone: 'UTC', workdays: [1], startMinute: 1020, endMinute: 540 })
      .expect(400);
  });

  it('refuses a time zone the runtime does not know', async () => {
    await request(app())
      .put('/api/v1/working-calendar')
      .set('Cookie', adminCookie)
      .send({
        timeZone: 'Middle/Earth',
        workdays: [1],
        startMinute: 540,
        endMinute: 1020,
      })
      .expect(400);
  });

  it('will not let a plain member change it', async () => {
    await request(app())
      .put('/api/v1/working-calendar')
      .set('Cookie', memberCookie)
      .send({ timeZone: 'UTC', workdays: [1], startMinute: 540, endMinute: 1020 })
      .expect(403);

    await request(app())
      .post('/api/v1/working-calendar/holidays')
      .set('Cookie', memberCookie)
      .send({ date: '2026-12-25', name: 'Christmas Day' })
      .expect(403);
  });

  it('adds and removes a holiday', async () => {
    const added = await request(app())
      .post('/api/v1/working-calendar/holidays')
      .set('Cookie', adminCookie)
      .send({ date: '2026-12-25', name: 'Christmas Day' })
      .expect(201);

    const listed = await request(app())
      .get('/api/v1/working-calendar')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(listed.body.calendar.holidays).toEqual([
      expect.objectContaining({ date: '2026-12-25', name: 'Christmas Day' }),
    ]);

    await request(app())
      .delete(`/api/v1/working-calendar/holidays/${added.body.holiday.holidayId}`)
      .set('Cookie', adminCookie)
      .expect(204);

    const after = await request(app())
      .get('/api/v1/working-calendar')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(after.body.calendar.holidays).toEqual([]);
  });

  it('rejects a holiday that is not a plain date', async () => {
    await request(app())
      .post('/api/v1/working-calendar/holidays')
      .set('Cookie', adminCookie)
      .send({ date: '25/12/2026', name: 'Christmas Day' })
      .expect(400);
  });

  // The claim the whole feature rests on: what is stored actually reaches
  // the engine, so a deadline moves when an administrator changes the
  // calendar. Asserted through buildEvaluationContext, which is the one
  // seam every task creation passes through.
  it('puts the configured calendar into the context the engine is given', async () => {
    await withTenantTransaction(db, organisationId, (trx) =>
      upsertOrganisationCalendar(trx, {
        organisationId,
        timeZone: 'Europe/London',
        workdays: [1, 2, 3, 4, 5],
        startMinute: 540,
        endMinute: 1020,
      }),
    );
    await withTenantTransaction(db, organisationId, (trx) =>
      addHoliday(trx, { organisationId, date: '2026-12-25', name: 'Christmas Day' }),
    );

    const context = await withTenantTransaction(db, organisationId, (trx) =>
      buildEvaluationContext(trx, {
        submitterUserId: memberUserId,
        correlationId: 'calendar-check',
        now: new Date('2026-12-24T11:00:00.000Z'),
      }),
    );

    expect(context.calendar?.timeZone).toBe('Europe/London');
    expect(context.calendar?.holidays).toContain('2026-12-25');
  });
});
