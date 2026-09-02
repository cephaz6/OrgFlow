import {
  createDb,
  createOrganisation,
  createTemplate,
  createUserWithIdentity,
  generateId,
  insertOrganisationMember,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import { createMongoClient, insertTemplateDocument } from '@orgflow/documents';
import { createDummyEmailSender } from '@orgflow/email';
import { createDummyPublisher } from '@orgflow/events';
import { createDummyFileStore } from '@orgflow/storage';
import type { OrganisationRole, TemplateBlueprint } from '@orgflow/types';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { buildSessionClaims, createSessionToken, SESSION_COOKIE_NAME } from '../auth/session.js';
import { createLogger } from '../logger.js';

const SESSION_SECRET = '99'.repeat(32);

function blueprint(overrides: Partial<TemplateBlueprint> = {}): TemplateBlueprint {
  return {
    key: 'expense-claim',
    name: 'Expense claim',
    form: { titleFieldKey: 'reason', sections: [] },
    workflow: {
      startStepKey: 'approval',
      steps: [
        {
          key: 'approval',
          name: 'Manager approval',
          type: 'approval',
          // Names a group that exists only in the originating organisation,
          // so a clone has something to reset (PRD.md §9.2, ADR-0043).
          assignment: { strategy: 'group', groupKey: 'finance' },
          allowedDecisions: ['approve', 'reject'],
          transitions: {
            approve: [{ when: null, to: '$completed' }],
            reject: [{ when: null, to: '$rejected' }],
          },
        },
      ],
    },
    ...overrides,
  };
}

describe('templates API against real Postgres and Mongo', () => {
  let db: Kysely<Database>;
  let mongoClient: MongoClient;
  let organisationId: string;
  let ownerCookie: string;
  let memberCookie: string;
  let otherOrganisationId: string;
  let otherOwnerCookie: string;

  async function cookieFor(userId: string, roles: OrganisationRole[], orgId: string) {
    const token = await createSessionToken(
      SESSION_SECRET,
      buildSessionClaims(userId, orgId, roles),
    );
    return `${SESSION_COOKIE_NAME}=${token}`;
  }

  async function seedTenant(label: string) {
    const user = await createUserWithIdentity(db, {
      email: `${label}-${generateId()}@example.invalid`,
      displayName: label,
      issuer: 'urn:orgflow:test',
      subject: `${label}-${generateId()}`,
    });
    const organisation = await createOrganisation(db, {
      name: `${label} tenant`,
      slug: `${label}-${generateId()}`,
      createdByUserId: user.userId,
    });
    const roles: OrganisationRole[] = ['owner', 'admin', 'processOwner', 'member'];
    await withTenantTransaction(db, organisation.organisationId, (trx) =>
      insertOrganisationMember(trx, {
        organisationId: organisation.organisationId,
        userId: user.userId,
        roles,
      }),
    );
    return {
      userId: user.userId,
      organisationId: organisation.organisationId,
      cookie: await cookieFor(user.userId, roles, organisation.organisationId),
    };
  }

  // Writes both halves the way the route does: document first, then the
  // registry row that points at it.
  async function seedTemplate(orgId: string, userId: string, name: string) {
    const templateId = generateId();
    const documentId = await insertTemplateDocument(mongoClient, {
      organisationId: orgId,
      templateId,
      blueprint: blueprint(),
      now: new Date().toISOString(),
    });
    await withTenantTransaction(db, orgId, (trx) =>
      createTemplate(trx, {
        templateId,
        organisationId: orgId,
        key: `expense-${generateId()}`,
        name,
        description: null,
        category: 'Finance',
        icon: null,
        documentId,
        createdByUserId: userId,
      }),
    );
    return templateId;
  }

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    mongoClient = await createMongoClient({ uri: process.env.ORGFLOW_TEST_MONGODB_URI! });

    const primary = await seedTenant('templates-route');
    organisationId = primary.organisationId;
    ownerCookie = primary.cookie;

    const plainUser = await createUserWithIdentity(db, {
      email: `templates-route-plain-${generateId()}@example.invalid`,
      displayName: 'Plain member',
      issuer: 'urn:orgflow:test',
      subject: `templates-route-plain-${generateId()}`,
    });
    await withTenantTransaction(db, organisationId, (trx) =>
      insertOrganisationMember(trx, {
        organisationId,
        userId: plainUser.userId,
        roles: ['member'],
      }),
    );
    memberCookie = await cookieFor(plainUser.userId, ['member'], organisationId);

    const other = await seedTenant('templates-route-other');
    otherOrganisationId = other.organisationId;
    otherOwnerCookie = other.cookie;
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

  it("does not list another organisation's unshared template", async () => {
    await seedTemplate(otherOrganisationId, (await seedTenant('x')).userId, 'Their private one');

    const response = await request(app())
      .get('/api/v1/templates')
      .set('Cookie', ownerCookie)
      .expect(200);

    const names = (response.body.data as { name: string }[]).map((row) => row.name);
    expect(names).not.toContain('Their private one');
  });

  it('returns 404 for a template belonging to another organisation', async () => {
    const templateId = await seedTemplate(
      otherOrganisationId,
      (await seedTenant('y')).userId,
      'Invisible',
    );

    await request(app())
      .get(`/api/v1/templates/${templateId}`)
      .set('Cookie', ownerCookie)
      .expect(404);
  });

  it('shares a template to the library, making it visible but not editable elsewhere', async () => {
    const templateId = await seedTemplate(organisationId, (await seedTenant('z')).userId, 'Shared');

    await request(app())
      .post(`/api/v1/templates/${templateId}/publish-to-library`)
      .set('Cookie', ownerCookie)
      .send({ published: true })
      .expect(204);

    // The other tenant can now read it...
    const detail = await request(app())
      .get(`/api/v1/templates/${templateId}`)
      .set('Cookie', otherOwnerCookie)
      .expect(200);
    expect(detail.body.template.scope).toBe('published');

    // ...but sharing is not surrender: editing and deleting still 404,
    // because the library policy is FOR SELECT only (ADR-0042).
    await request(app())
      .patch(`/api/v1/templates/${templateId}`)
      .set('Cookie', otherOwnerCookie)
      .send({ name: 'Hijacked' })
      .expect(404);

    await request(app())
      .delete(`/api/v1/templates/${templateId}`)
      .set('Cookie', otherOwnerCookie)
      .expect(404);
  });

  it('clones a shared template into the calling organisation, with warnings', async () => {
    const templateId = await seedTemplate(
      organisationId,
      (await seedTenant('w')).userId,
      'Cloneable',
    );
    await request(app())
      .post(`/api/v1/templates/${templateId}/publish-to-library`)
      .set('Cookie', ownerCookie)
      .send({ published: true })
      .expect(204);

    const response = await request(app())
      .post(`/api/v1/templates/${templateId}/clone`)
      .set('Cookie', otherOwnerCookie)
      .expect(201);

    expect(response.body.definitionId).toEqual(expect.any(String));
    expect(response.body.versionId).toEqual(expect.any(String));
    // The group the blueprint named belongs to the originating tenant, so
    // the clone flags it rather than pointing at a group that is not there.
    expect(response.body.warnings).toEqual([
      expect.objectContaining({ reason: 'group', original: 'finance' }),
    ]);
  });

  it('refuses to clone a template the caller cannot see', async () => {
    const templateId = await seedTemplate(
      otherOrganisationId,
      (await seedTenant('v')).userId,
      'Not for you',
    );

    await request(app())
      .post(`/api/v1/templates/${templateId}/clone`)
      .set('Cookie', ownerCookie)
      .expect(404);
  });

  it('lets any member browse, but only a process owner clone', async () => {
    await request(app()).get('/api/v1/templates').set('Cookie', memberCookie).expect(200);

    const templateId = await seedTemplate(
      organisationId,
      (await seedTenant('u')).userId,
      'Owner only',
    );

    await request(app())
      .post(`/api/v1/templates/${templateId}/clone`)
      .set('Cookie', memberCookie)
      .expect(403);
  });
});
