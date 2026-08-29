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

const SESSION_SECRET = '88'.repeat(32);
const VALID_ARN = 'arn:aws:secretsmanager:eu-west-2:000000000000:secret:test-client-secret';

describe('identity providers API against real Postgres', () => {
  let db: Kysely<Database>;
  let mongoClient: MongoClient;
  let organisationId: string;
  let adminCookie: string;
  let memberCookie: string;
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
      email: `idp-route-owner-${generateId()}@example.invalid`,
      displayName: 'IdP Route Owner',
      issuer: 'urn:orgflow:test',
      subject: `idp-route-owner-${generateId()}`,
    });
    const organisation = await createOrganisation(db, {
      name: 'IdP route tenant',
      slug: `idp-route-tenant-${generateId()}`,
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

    const plain = await memberWithRoles('idp-route-plain', ['member'], organisationId);
    memberCookie = plain.cookie;

    const otherOwner = await createUserWithIdentity(db, {
      email: `idp-route-other-owner-${generateId()}@example.invalid`,
      displayName: 'IdP Route Other Owner',
      issuer: 'urn:orgflow:test',
      subject: `idp-route-other-owner-${generateId()}`,
    });
    const otherOrganisation = await createOrganisation(db, {
      name: 'IdP route other tenant',
      slug: `idp-route-other-tenant-${generateId()}`,
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

  it('refuses to list for a member without the admin role', async () => {
    const response = await request(app())
      .get('/api/v1/identity-providers')
      .set('Cookie', memberCookie);

    expect(response.status).toBe(403);
  });

  it('creates, lists, updates and deletes a provider for an admin', async () => {
    const created = await request(app())
      .post('/api/v1/identity-providers')
      .set('Cookie', adminCookie)
      .send({
        displayName: 'Contoso Entra ID',
        issuerUrl: 'https://login.microsoftonline.com/contoso/v2.0',
        clientId: 'contoso-client-id',
        clientSecretRef: VALID_ARN,
        emailDomains: ['Contoso.com'],
      });

    expect(created.status).toBe(201);
    expect(created.body.displayName).toBe('Contoso Entra ID');
    // Normalised to lowercase server-side: a domain check against a real
    // sign-in email is always lowercased first (auth.ts's emailDomain), so
    // a mixed-case entry here would silently never match.
    expect(created.body.emailDomains).toEqual(['contoso.com']);
    expect(created.body.enabled).toBe(true);
    const providerId = created.body.providerId as string;

    const listed = await request(app())
      .get('/api/v1/identity-providers')
      .set('Cookie', adminCookie);
    expect(listed.status).toBe(200);
    expect(listed.body.providers.map((p: { providerId: string }) => p.providerId)).toContain(
      providerId,
    );

    const updated = await request(app())
      .patch(`/api/v1/identity-providers/${providerId}`)
      .set('Cookie', adminCookie)
      .send({ enabled: false });
    expect(updated.status).toBe(200);
    expect(updated.body.enabled).toBe(false);

    const deleted = await request(app())
      .delete(`/api/v1/identity-providers/${providerId}`)
      .set('Cookie', adminCookie);
    expect(deleted.status).toBe(204);

    const listedAfterDelete = await request(app())
      .get('/api/v1/identity-providers')
      .set('Cookie', adminCookie);
    expect(
      listedAfterDelete.body.providers.map((p: { providerId: string }) => p.providerId),
    ).not.toContain(providerId);
  });

  it('rejects a clientSecretRef that is not a Secrets Manager ARN', async () => {
    const response = await request(app())
      .post('/api/v1/identity-providers')
      .set('Cookie', adminCookie)
      .send({
        displayName: 'Bad Secret',
        issuerUrl: 'https://login.example.com',
        clientId: 'client-id',
        clientSecretRef: 'not-an-arn',
        emailDomains: ['bad-secret.example'],
      });

    expect(response.status).toBe(400);
  });

  it('rejects a non-https issuer URL', async () => {
    const response = await request(app())
      .post('/api/v1/identity-providers')
      .set('Cookie', adminCookie)
      .send({
        displayName: 'Insecure Issuer',
        issuerUrl: 'http://login.example.com',
        clientId: 'client-id',
        clientSecretRef: VALID_ARN,
        emailDomains: ['insecure.example'],
      });

    expect(response.status).toBe(400);
  });

  it('404s updating a provider that belongs to a different tenant, not 403', async () => {
    const created = await request(app())
      .post('/api/v1/identity-providers')
      .set('Cookie', otherTenantCookie)
      .send({
        displayName: 'Other tenant provider',
        issuerUrl: 'https://login.example.com',
        clientId: 'other-client-id',
        clientSecretRef: VALID_ARN,
        emailDomains: ['other-tenant.example'],
      });
    expect(created.status).toBe(201);
    const providerId = created.body.providerId as string;

    // Cross-tenant reads as absent under RLS (PRD.md §11.10, ADR-0015): the
    // same 404 a genuinely unknown provider id gets, never a 403 that would
    // confirm the id refers to something real.
    const response = await request(app())
      .patch(`/api/v1/identity-providers/${providerId}`)
      .set('Cookie', adminCookie)
      .send({ enabled: false });

    expect(response.status).toBe(404);
  });
});
