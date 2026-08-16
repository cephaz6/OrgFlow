import {
  createDb,
  createOrganisation,
  createUserWithIdentity,
  findCaseById,
  findProcessVersionById,
  generateId,
  insertOrganisationMember,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import { createMongoClient, ensureIndexes, readCaseValues } from '@orgflow/documents';
import { createDummyPublisher } from '@orgflow/events';
import type { OrganisationRole } from '@orgflow/types';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { buildSessionClaims, createSessionToken, SESSION_COOKIE_NAME } from './auth/session.js';
import { createLogger } from './logger.js';
import { ensureLaptopRequestSeeded } from './seed/laptop-request.js';

const SESSION_SECRET = '44'.repeat(32);

const ALL_ROLES: OrganisationRole[] = ['owner', 'admin', 'processOwner', 'approver', 'member'];

// PRD.md §11.10 and GOV-STANDARDS.md §6.1. Two complete tenants, each
// running the same seeded process, each holding live cases and open tasks,
// probing every endpoint the Cases and Tasks APIs expose in both
// directions.
//
// The adversary here is deliberately the strongest one the design permits:
// a genuinely authenticated user, holding every role in their own
// organisation, with a valid session and a correct resource id belonging to
// the other tenant. That is the case tenant isolation actually has to
// survive, not an anonymous request, and it is the reason every probe below
// asserts 404 rather than merely "not 200": a 403 would confirm the
// resource exists, which §11.10 rules out.
describe('cross-tenant isolation', () => {
  let db: Kysely<Database>;
  let mongoClient: MongoClient;

  interface Tenant {
    label: string;
    organisationId: string;
    userId: string;
    cookie: string;
    definitionId: string;
    versionId: string;
    caseId: string;
    reference: string;
    taskId: string;
  }

  let alpha: Tenant;
  let beta: Tenant;

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    mongoClient = await createMongoClient({ uri: process.env.ORGFLOW_TEST_MONGODB_URI! });
    await ensureIndexes(mongoClient);

    alpha = await buildTenant('alpha');
    beta = await buildTenant('beta');
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await mongoClient.close();
  });

  function buildApp() {
    return createApp({
      db,
      mongoClient,
      publisher: createDummyPublisher(),
      corsOrigin: 'http://localhost:3000',
      logger: createLogger('silent'),
      sessionSecret: SESSION_SECRET,
      isLocal: true,
      apiBaseUrl: 'http://localhost:4000',
    });
  }

  // A whole working tenant: organisation, an owner holding every role, the
  // seeded Laptop Request, and one submitted case sitting on an open task.
  async function buildTenant(label: string): Promise<Tenant> {
    const user = await createUserWithIdentity(db, {
      email: `${label}-${generateId()}@example.invalid`,
      displayName: `${label} owner`,
      issuer: 'urn:orgflow:test',
      subject: `${label}-${generateId()}`,
    });

    const organisation = await createOrganisation(db, {
      name: `${label} tenant`,
      slug: `${label}-${generateId()}`,
      createdByUserId: user.userId,
    });

    await withTenantTransaction(db, organisation.organisationId, (trx) =>
      insertOrganisationMember(trx, {
        organisationId: organisation.organisationId,
        userId: user.userId,
        roles: ALL_ROLES,
      }),
    );

    const seeded = await ensureLaptopRequestSeeded(db, mongoClient, {
      organisationId: organisation.organisationId,
      ownerUserId: user.userId,
    });

    const token = await createSessionToken(
      SESSION_SECRET,
      buildSessionClaims(user.userId, organisation.organisationId, ALL_ROLES),
    );
    const cookie = `${SESSION_COOKIE_NAME}=${token}`;

    const app = buildApp();
    const created = await request(app)
      .post('/api/v1/cases')
      .set('Cookie', cookie)
      .send({
        definitionId: seeded.definitionId,
        values: {
          laptopModel: 'mbp14',
          estimatedCost: 800,
          justification: `A laptop for the ${label} tenant, justified at length.`,
          requiredBy: '2026-12-01',
        },
      });
    expect(created.status).toBe(201);

    const submitted = await request(app)
      .post(`/api/v1/cases/${created.body.case.caseId}/submit`)
      .set('Cookie', cookie);
    expect(submitted.status).toBe(200);

    return {
      label,
      organisationId: organisation.organisationId,
      userId: user.userId,
      cookie,
      definitionId: seeded.definitionId,
      versionId: seeded.versionId,
      caseId: submitted.body.case.caseId,
      reference: submitted.body.case.reference,
      taskId: submitted.body.tasks[0].taskId,
    };
  }

  // Each probe is run in both directions, so a leak that only exists one way
  // round (an ordering artefact, say) cannot hide.
  function bothDirections(): Array<{ intruder: Tenant; victim: Tenant }> {
    return [
      { intruder: alpha, victim: beta },
      { intruder: beta, victim: alpha },
    ];
  }

  it('sets up two independent tenants running the same process', () => {
    expect(alpha.organisationId).not.toBe(beta.organisationId);
    expect(alpha.definitionId).not.toBe(beta.definitionId);
    expect(alpha.caseId).not.toBe(beta.caseId);

    // Each tenant numbers its own cases: UNIQUE (organisation_id,
    // reference) means both legitimately hold LAP-000001 (ADR-0013).
    expect(alpha.reference).toBe('LAP-000001');
    expect(beta.reference).toBe('LAP-000001');
  });

  it('refuses every case endpoint for another tenant’s case, with 404', async () => {
    for (const { intruder, victim } of bothDirections()) {
      const app = buildApp();

      const probes = [
        request(app).get(`/api/v1/cases/${victim.caseId}`).set('Cookie', intruder.cookie),
        request(app).get(`/api/v1/cases/${victim.caseId}/timeline`).set('Cookie', intruder.cookie),
        request(app)
          .patch(`/api/v1/cases/${victim.caseId}`)
          .set('Cookie', intruder.cookie)
          .send({ title: 'Taken over' }),
        request(app).post(`/api/v1/cases/${victim.caseId}/submit`).set('Cookie', intruder.cookie),
        request(app)
          .post(`/api/v1/cases/${victim.caseId}/resubmit`)
          .set('Cookie', intruder.cookie)
          .send({ values: { estimatedCost: 1 } }),
        request(app)
          .post(`/api/v1/cases/${victim.caseId}/cancel`)
          .set('Cookie', intruder.cookie)
          .send({ reason: 'Cancelled by somebody who should not be able to.' }),
      ];

      for (const probe of probes) {
        const response = await probe;
        expect(
          response.status,
          `${intruder.label} probing ${victim.label}: ${probe.method} ${probe.url}`,
        ).toBe(404);
        expect(response.status).not.toBe(403);
        expect(response.headers['content-type']).toContain('application/problem+json');
      }
    }
  });

  it('refuses every task endpoint for another tenant’s task, with 404', async () => {
    for (const { intruder, victim } of bothDirections()) {
      const app = buildApp();

      const probes = [
        request(app).get(`/api/v1/tasks/${victim.taskId}`).set('Cookie', intruder.cookie),
        request(app)
          .post(`/api/v1/tasks/${victim.taskId}/claim`)
          .set('Cookie', intruder.cookie)
          .send({}),
        request(app)
          .post(`/api/v1/tasks/${victim.taskId}/decide`)
          .set('Cookie', intruder.cookie)
          .send({ decision: 'approve' }),
      ];

      for (const probe of probes) {
        const response = await probe;
        expect(
          response.status,
          `${intruder.label} probing ${victim.label}: ${probe.method} ${probe.url}`,
        ).toBe(404);
        expect(response.status).not.toBe(403);
      }
    }
  });

  it('refuses another tenant’s process definition, with 404', async () => {
    for (const { intruder, victim } of bothDirections()) {
      const response = await request(buildApp())
        .get(`/api/v1/process-definitions/${victim.definitionId}`)
        .set('Cookie', intruder.cookie);

      expect(response.status).toBe(404);
      expect(response.status).not.toBe(403);
    }
  });

  it('scopes definition lookup by key to the caller’s own tenant', async () => {
    // Both tenants run a process under the same key, which is exactly the
    // case a by-key lookup could get wrong: the key is unique per
    // organisation, not globally, so the route must resolve to the caller's
    // own definition rather than whichever row it finds first.
    for (const { intruder, victim } of bothDirections()) {
      const response = await request(buildApp())
        .get('/api/v1/process-definitions/by-key/laptop-request')
        .set('Cookie', intruder.cookie);

      expect(response.status).toBe(200);
      expect(response.body.definition.definitionId).toBe(intruder.definitionId);
      expect(response.body.definition.definitionId).not.toBe(victim.definitionId);
    }
  });

  it('refuses to start a case against another tenant’s definition', async () => {
    for (const { intruder, victim } of bothDirections()) {
      const response = await request(buildApp())
        .post('/api/v1/cases')
        .set('Cookie', intruder.cookie)
        .send({ definitionId: victim.definitionId, values: { laptopModel: 'mbp14' } });

      // A 201 here would be the worst failure in the suite: a case in one
      // organisation executing another organisation's workflow.
      expect(response.status).toBe(404);
    }
  });

  it('never includes another tenant’s rows in any list endpoint', async () => {
    for (const { intruder, victim } of bothDirections()) {
      const app = buildApp();

      const cases = await request(app).get('/api/v1/cases').set('Cookie', intruder.cookie);
      expect(cases.status).toBe(200);
      expect(cases.body.data.map((found: { caseId: string }) => found.caseId)).not.toContain(
        victim.caseId,
      );

      const definitions = await request(app)
        .get('/api/v1/process-definitions')
        .set('Cookie', intruder.cookie);
      expect(definitions.status).toBe(200);
      expect(
        definitions.body.data.map((entry: { definitionId: string }) => entry.definitionId),
      ).not.toContain(victim.definitionId);
      // Each tenant sees exactly its own copy of the seeded process.
      expect(definitions.body.data).toHaveLength(1);

      for (const path of ['/api/v1/tasks', '/api/v1/tasks/available']) {
        const tasks = await request(app).get(path).set('Cookie', intruder.cookie);
        expect(tasks.status).toBe(200);
        expect(tasks.body.data.map((task: { taskId: string }) => task.taskId)).not.toContain(
          victim.taskId,
        );
      }
    }
  });

  it('ignores an organisationId supplied in a body, query or header', async () => {
    // CLAUDE.md §3: tenant context comes from the authenticated session,
    // never from a body, query parameter or header. These are the three
    // places a client could try to assert one.
    const app = buildApp();

    const viaQuery = await request(app)
      .get(`/api/v1/cases?organisationId=${beta.organisationId}`)
      .set('Cookie', alpha.cookie);
    expect(viaQuery.status).toBe(200);
    expect(viaQuery.body.data.map((found: { caseId: string }) => found.caseId)).not.toContain(
      beta.caseId,
    );

    const viaHeader = await request(app)
      .get('/api/v1/cases')
      .set('Cookie', alpha.cookie)
      .set('X-Organisation-Id', beta.organisationId);
    expect(viaHeader.body.data.map((found: { caseId: string }) => found.caseId)).not.toContain(
      beta.caseId,
    );

    const viaBody = await request(app)
      .post('/api/v1/cases')
      .set('Cookie', alpha.cookie)
      .send({
        definitionId: alpha.definitionId,
        organisationId: beta.organisationId,
        values: { laptopModel: 'mbp14' },
      });
    expect(viaBody.status).toBe(201);

    // The case landed in alpha regardless of what the body asked for.
    const created = await withTenantTransaction(db, alpha.organisationId, (trx) =>
      findCaseById(trx, viaBody.body.case.caseId),
    );
    expect(created?.organisationId).toBe(alpha.organisationId);
  });

  it('keeps a dual-member’s session scoped to the organisation it names', async () => {
    // The sharpest case the design allows: one real person, legitimately a
    // member of both organisations, holding a session that names only one.
    // Membership in the other must not widen what this session can reach,
    // because the tenant comes from the session and nothing else.
    const dual = await createUserWithIdentity(db, {
      email: `dual-${generateId()}@example.invalid`,
      displayName: 'Member of both tenants',
      issuer: 'urn:orgflow:test',
      subject: `dual-${generateId()}`,
    });

    for (const tenant of [alpha, beta]) {
      await withTenantTransaction(db, tenant.organisationId, (trx) =>
        insertOrganisationMember(trx, {
          organisationId: tenant.organisationId,
          userId: dual.userId,
          roles: ['member', 'admin'],
        }),
      );
    }

    const asAlpha = `${SESSION_COOKIE_NAME}=${await createSessionToken(
      SESSION_SECRET,
      buildSessionClaims(dual.userId, alpha.organisationId, ['member', 'admin']),
    )}`;

    const app = buildApp();

    // Admin in alpha, so alpha's case is visible (PRD.md §12.3).
    const ownTenant = await request(app)
      .get(`/api/v1/cases/${alpha.caseId}`)
      .set('Cookie', asAlpha);
    expect(ownTenant.status).toBe(200);

    // Admin in beta too, but this session does not name beta.
    const otherTenant = await request(app)
      .get(`/api/v1/cases/${beta.caseId}`)
      .set('Cookie', asAlpha);
    expect(otherTenant.status).toBe(404);

    const list = await request(app).get('/api/v1/cases').set('Cookie', asAlpha);
    expect(list.body.data.map((found: { caseId: string }) => found.caseId)).not.toContain(
      beta.caseId,
    );
  });

  it('scopes the Mongo document stores by organisation, not only Postgres', async () => {
    // Tenant isolation has to hold in both datastores. Postgres has RLS to
    // fall back on; Mongo has only the organisationId every query in
    // packages/documents carries, so it is worth asserting directly rather
    // than inferring it from the API returning 404.
    const alphaValues = await readCaseValues(mongoClient, alpha.organisationId, alpha.caseId);
    expect(alphaValues.estimatedCost).toBe(800);

    // The same case id, read under the other tenant, yields nothing.
    const crossRead = await readCaseValues(mongoClient, beta.organisationId, alpha.caseId);
    expect(crossRead).toEqual({});
  });

  it('refuses another tenant’s definition document even given a valid document id', async () => {
    // Bypassing the id-based route by asking for the document directly:
    // process_versions is tenant-scoped, so the intruder cannot even learn
    // the document id, and the document store re-asserts the tenant anyway.
    const victimVersion = await withTenantTransaction(db, beta.organisationId, (trx) =>
      findProcessVersionById(trx, beta.versionId),
    );
    expect(victimVersion).not.toBeNull();

    const asAlpha = await withTenantTransaction(db, alpha.organisationId, (trx) =>
      findProcessVersionById(trx, beta.versionId),
    );
    expect(asAlpha).toBeNull();

    const { findProcessDefinitionDocumentById } = await import('@orgflow/documents');
    const crossRead = await findProcessDefinitionDocumentById(
      mongoClient,
      alpha.organisationId,
      victimVersion!.documentId,
    );
    expect(crossRead).toBeNull();
  });

  it('leaves a victim’s case and task untouched after every probe', async () => {
    // The whole suite has been firing writes at both tenants. Neither
    // should have moved: a refusal that still had a side effect would be a
    // leak of a different kind.
    for (const tenant of [alpha, beta]) {
      const found = await withTenantTransaction(db, tenant.organisationId, (trx) =>
        findCaseById(trx, tenant.caseId),
      );

      expect(found?.status).toBe('active');
      expect(found?.currentStepKey).toBe('managerApproval');
      expect(found?.reference).toBe('LAP-000001');
      expect(found?.title).toBe('mbp14');
    }
  });

  it('rejects a session signed with the wrong secret', async () => {
    // Forging a session for another tenant requires ORGFLOW_SESSION_SECRET.
    // Without it the token does not decrypt, and the request is anonymous.
    const forged = await createSessionToken(
      '55'.repeat(32),
      buildSessionClaims(beta.userId, beta.organisationId, ALL_ROLES),
    );

    const response = await request(buildApp())
      .get(`/api/v1/cases/${beta.caseId}`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${forged}`);

    expect(response.status).toBe(401);
  });
});
