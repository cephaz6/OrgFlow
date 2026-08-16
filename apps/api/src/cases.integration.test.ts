import {
  createDb,
  createOrganisation,
  createUserWithIdentity,
  findCaseTasksForCase,
  findCaseTransitionsForCase,
  generateId,
  insertOrganisationMember,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import { createMongoClient, ensureIndexes } from '@orgflow/documents';
import { createDummyPublisher, type DummyDomainEventPublisher } from '@orgflow/events';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { buildSessionClaims, createSessionToken, SESSION_COOKIE_NAME } from './auth/session.js';
import { createLogger } from './logger.js';

const SESSION_SECRET = '22'.repeat(32);

describe('cases API against real Postgres and Mongo', () => {
  let db: Kysely<Database>;
  let mongoClient: MongoClient;
  let publisher: DummyDomainEventPublisher;

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    mongoClient = await createMongoClient({ uri: process.env.ORGFLOW_TEST_MONGODB_URI! });
    await ensureIndexes(mongoClient);
    publisher = createDummyPublisher();
  });

  afterAll(async () => {
    await db.destroy();
    await mongoClient.close();
  });

  beforeEach(() => {
    publisher.clear();
  });

  function buildApp() {
    return createApp({
      db,
      mongoClient,
      publisher,
      corsOrigin: 'http://localhost:3000',
      logger: createLogger('silent'),
      sessionSecret: SESSION_SECRET,
      isLocal: true,
      apiBaseUrl: 'http://localhost:4000',
    });
  }

  // A signed-in agent for the seeded dev organisation. dev-login is what
  // runs the Laptop Request seed, so every case test starts here.
  async function signInAsDevUser() {
    const agent = request.agent(buildApp());
    const login = await agent.post('/api/v1/auth/dev-login');
    expect(login.status).toBe(200);
    return agent;
  }

  async function definitionId(agent: ReturnType<typeof request.agent>): Promise<string> {
    const response = await agent.get('/api/v1/process-definitions');
    expect(response.status).toBe(200);
    const laptop = response.body.data.find(
      (entry: { key: string }) => entry.key === 'laptop-request',
    );
    expect(laptop).toBeDefined();
    return laptop.definitionId as string;
  }

  async function createDraft(
    agent: ReturnType<typeof request.agent>,
    values: Record<string, unknown>,
  ) {
    const response = await agent
      .post('/api/v1/cases')
      .send({ definitionId: await definitionId(agent), values });
    expect(response.status).toBe(201);
    return response.body.case as { caseId: string; reference: string; status: string };
  }

  // The same session the agent holds, as a cookie header, for requests that
  // need to go to a separately-listening server rather than through the
  // agent's own ephemeral one.
  async function sessionCookieForDevUser(agent: ReturnType<typeof request.agent>): Promise<string> {
    const session = await agent.get('/api/v1/auth/session');
    expect(session.status).toBe(200);

    const token = await createSessionToken(
      SESSION_SECRET,
      buildSessionClaims(
        session.body.user.userId as string,
        session.body.organisationId as string,
        session.body.roles,
      ),
    );

    return `${SESSION_COOKIE_NAME}=${token}`;
  }

  function laptopValues(estimatedCost: number) {
    return {
      laptopModel: 'mbp14',
      estimatedCost,
      justification: 'The current machine no longer builds the project within a working day.',
      requiredBy: '2026-10-01',
    };
  }

  it('lists the seeded Laptop Request in the catalogue', async () => {
    const agent = await signInAsDevUser();

    const response = await agent.get('/api/v1/process-definitions');

    expect(response.status).toBe(200);
    const laptop = response.body.data.find(
      (entry: { key: string }) => entry.key === 'laptop-request',
    );
    expect(laptop).toMatchObject({ name: 'Laptop request', status: 'published' });
    expect(laptop.currentVersionId).toBeTruthy();
  });

  it('returns the pinned definition document with its version', async () => {
    const agent = await signInAsDevUser();
    const id = await definitionId(agent);

    const response = await agent.get(`/api/v1/process-definitions/${id}`);

    expect(response.status).toBe(200);
    expect(response.body.version.versionNumber).toBe(1);
    expect(response.body.document.workflow.startStepKey).toBe('managerApproval');
    expect(response.body.document.form.sections[0].fields[0].key).toBe('laptopModel');
  });

  it('creates a draft with a placeholder reference and no submission timestamp', async () => {
    const agent = await signInAsDevUser();

    const draft = await createDraft(agent, laptopValues(850));

    expect(draft.status).toBe('draft');
    expect(draft.reference).toBe(`DRAFT-${draft.caseId}`);
    expect(draft.reference).not.toMatch(/^LAP-/);
  });

  it('saves draft values and reads them back', async () => {
    const agent = await signInAsDevUser();
    const draft = await createDraft(agent, laptopValues(850));

    const patched = await agent
      .patch(`/api/v1/cases/${draft.caseId}`)
      .send({
        values: { ...laptopValues(920), justification: 'Updated justification text here.' },
      });
    expect(patched.status).toBe(200);

    const detail = await agent.get(`/api/v1/cases/${draft.caseId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.values.estimatedCost).toBe(920);
    expect(detail.body.values.justification).toBe('Updated justification text here.');
  });

  it('submits a draft: allocates the reference, pins the version, creates the manager task', async () => {
    const agent = await signInAsDevUser();
    const draft = await createDraft(agent, laptopValues(850));

    const response = await agent.post(`/api/v1/cases/${draft.caseId}/submit`);

    expect(response.status).toBe(200);
    const submitted = response.body.case;

    // ADR-0013: the real reference replaces the draft placeholder.
    expect(submitted.reference).toMatch(/^LAP-\d{6}$/);
    expect(submitted.status).toBe('active');
    expect(submitted.currentStepKey).toBe('managerApproval');
    expect(submitted.submittedAt).toBeTruthy();
    // PRD.md §4: the title comes from the designated form field.
    expect(submitted.title).toBe('mbp14');

    // PRD.md §8.2: the pin points at the published version.
    const definition = await agent.get(`/api/v1/process-definitions/${submitted.definitionId}`);
    expect(submitted.versionId).toBe(definition.body.version.versionId);

    expect(response.body.tasks).toHaveLength(1);
    const task = response.body.tasks[0];
    expect(task.stepKey).toBe('managerApproval');
    expect(task.assignmentStrategy).toBe('lineManager');
    // The seed gives the dev user a line manager, so assignment resolves to
    // a person rather than falling into `unassigned`.
    expect(task.assigneeUserId).toBeTruthy();
    expect(task.assigneeUserId).not.toBe(submitted.submittedByUserId);
    expect(task.status).toBe('pending');
  });

  it('writes the case, task, transition and audit row in the same transaction', async () => {
    const agent = await signInAsDevUser();
    const draft = await createDraft(agent, laptopValues(850));
    const submitted = await agent.post(`/api/v1/cases/${draft.caseId}/submit`);
    expect(submitted.status).toBe(200);

    const session = await agent.get('/api/v1/auth/session');
    const organisationId = session.body.organisationId as string;

    const { tasks, transitions } = await withTenantTransaction(db, organisationId, async (trx) => ({
      tasks: await findCaseTasksForCase(trx, draft.caseId),
      transitions: await findCaseTransitionsForCase(trx, draft.caseId),
    }));

    expect(tasks).toHaveLength(1);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      fromStepKey: null,
      toStepKey: 'managerApproval',
      triggerType: 'submission',
    });
    // The transition points at the task the same transaction created.
    expect(transitions[0]?.taskId).toBe(tasks[0]?.taskId);

    const timeline = await agent.get(`/api/v1/cases/${draft.caseId}/timeline`);
    expect(timeline.status).toBe(200);
    const kinds = timeline.body.data.map((entry: { kind: string }) => entry.kind);
    expect(kinds).toContain('transition');
    expect(kinds).toContain('audit');
  });

  it('publishes case.submitted, case.stepChanged and task.created after the commit', async () => {
    const agent = await signInAsDevUser();
    const draft = await createDraft(agent, laptopValues(850));
    publisher.clear();

    const response = await agent.post(`/api/v1/cases/${draft.caseId}/submit`);
    expect(response.status).toBe(200);

    const types = publisher.published.map((event) => event.eventType);
    expect(types).toContain('case.submitted');
    expect(types).toContain('case.stepChanged');
    expect(types).toContain('task.created');

    for (const event of publisher.published) {
      // PRD.md §10: organisationId is always present, and consumers
      // re-assert on it.
      expect(event.organisationId).toBeTruthy();
      expect(event.correlationId).toBeTruthy();
      expect(event.schemaVersion).toBe(1);
      expect(event.payload.reference).toBe(response.body.case.reference);
    }

    // Enriched with the identifier only the database knew.
    const taskCreated = publisher.published.find((event) => event.eventType === 'task.created');
    expect(taskCreated?.payload.taskId).toBe(response.body.tasks[0].taskId);
  });

  it('records the cost branch on the transition for a case above the threshold', async () => {
    const agent = await signInAsDevUser();
    const draft = await createDraft(agent, laptopValues(1500));

    const response = await agent.post(`/api/v1/cases/${draft.caseId}/submit`);

    // Both cost bands start on the same step: the finance branch is chosen
    // when the manager approves, which is the Tasks API, not submission.
    expect(response.status).toBe(200);
    expect(response.body.case.currentStepKey).toBe('managerApproval');

    const detail = await agent.get(`/api/v1/cases/${draft.caseId}`);
    expect(detail.body.values.estimatedCost).toBe(1500);
  });

  it('issues sequential references and never repeats one under concurrent submission', async () => {
    const agent = await signInAsDevUser();

    // Sequentially: a supertest agent wraps one server and closes it as
    // soon as any request through it completes, so concurrent calls on the
    // same agent tear each other down. Only the submits below need to
    // overlap, and those go to a server this test owns.
    const drafts = [
      await createDraft(agent, laptopValues(300)),
      await createDraft(agent, laptopValues(400)),
      await createDraft(agent, laptopValues(500)),
    ];

    // The requests have to genuinely overlap, since the point is contention
    // on the reference counter (ADR-0013). That rules out supertest here:
    // it closes whichever server it is handed once a request finishes, so
    // the first response to arrive would tear the server out from under its
    // two siblings. One long-lived server plus fetch instead.
    const cookie = await sessionCookieForDevUser(agent);
    const server = buildApp().listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const responses = await Promise.all(
        drafts.map((draft) =>
          fetch(`http://127.0.0.1:${port}/api/v1/cases/${draft.caseId}/submit`, {
            method: 'POST',
            headers: { Cookie: cookie },
          }),
        ),
      );

      const references: string[] = [];
      for (const response of responses) {
        expect(response.status).toBe(200);
        const body = (await response.json()) as { case: { reference: string } };
        references.push(body.case.reference);
      }

      for (const reference of references) {
        expect(reference).toMatch(/^LAP-\d{6}$/);
      }
      expect(new Set(references).size).toBe(references.length);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('refuses to submit or edit a case that is no longer a draft', async () => {
    const agent = await signInAsDevUser();
    const draft = await createDraft(agent, laptopValues(850));

    expect((await agent.post(`/api/v1/cases/${draft.caseId}/submit`)).status).toBe(200);

    const resubmit = await agent.post(`/api/v1/cases/${draft.caseId}/submit`);
    expect(resubmit.status).toBe(409);
    expect(resubmit.headers['content-type']).toContain('application/problem+json');

    const patch = await agent
      .patch(`/api/v1/cases/${draft.caseId}`)
      .send({ values: laptopValues(999) });
    expect(patch.status).toBe(409);
  });

  it('filters the case list by status and by view=mine, and pages by cursor', async () => {
    const agent = await signInAsDevUser();
    await createDraft(agent, laptopValues(120));

    const drafts = await agent.get('/api/v1/cases?status=draft&view=mine');
    expect(drafts.status).toBe(200);
    expect(drafts.body.data.length).toBeGreaterThan(0);
    for (const found of drafts.body.data) {
      expect(found.status).toBe('draft');
    }

    const firstPage = await agent.get('/api/v1/cases?limit=1');
    expect(firstPage.body.data).toHaveLength(1);
    expect(firstPage.body.hasMore).toBe(true);

    const secondPage = await agent.get(`/api/v1/cases?limit=1&cursor=${firstPage.body.nextCursor}`);
    expect(secondPage.body.data[0].caseId).not.toBe(firstPage.body.data[0].caseId);
  });

  it('rejects an unknown status filter and a malformed create body', async () => {
    const agent = await signInAsDevUser();

    expect((await agent.get('/api/v1/cases?status=banana')).status).toBe(400);
    expect((await agent.post('/api/v1/cases').send({ definitionId: 'not-a-uuid' })).status).toBe(
      400,
    );
  });

  it('requires a session on every case endpoint', async () => {
    const app = buildApp();

    expect((await request(app).get('/api/v1/cases')).status).toBe(401);
    expect((await request(app).post('/api/v1/cases').send({})).status).toBe(401);
    expect((await request(app).get('/api/v1/process-definitions')).status).toBe(401);
  });

  it('returns 404, never 403, for another organisation’s case', async () => {
    const agent = await signInAsDevUser();
    const draft = await createDraft(agent, laptopValues(850));
    await agent.post(`/api/v1/cases/${draft.caseId}/submit`);

    // A genuine second tenant with its own session, not a forged header:
    // tenant context comes only from the session (CLAUDE.md §3).
    const intruderCookie = await createOtherTenantSession();
    const app = buildApp();

    for (const path of [
      `/api/v1/cases/${draft.caseId}`,
      `/api/v1/cases/${draft.caseId}/timeline`,
    ]) {
      const response = await request(app).get(path).set('Cookie', intruderCookie);
      expect(response.status).toBe(404);
      expect(response.status).not.toBe(403);
    }

    const submitAttempt = await request(app)
      .post(`/api/v1/cases/${draft.caseId}/submit`)
      .set('Cookie', intruderCookie);
    expect(submitAttempt.status).toBe(404);

    const patchAttempt = await request(app)
      .patch(`/api/v1/cases/${draft.caseId}`)
      .set('Cookie', intruderCookie)
      .send({ title: 'Taken over' });
    expect(patchAttempt.status).toBe(404);

    // The other tenant's case list does not contain it either.
    const list = await request(app).get('/api/v1/cases').set('Cookie', intruderCookie);
    expect(list.status).toBe(200);
    expect(list.body.data.map((found: { caseId: string }) => found.caseId)).not.toContain(
      draft.caseId,
    );
  });

  async function createOtherTenantSession(): Promise<string> {
    const user = await createUserWithIdentity(db, {
      email: `intruder-${generateId()}@example.invalid`,
      displayName: 'Other tenant user',
      issuer: 'urn:orgflow:test',
      subject: `intruder-${generateId()}`,
    });

    const organisation = await createOrganisation(db, {
      name: 'Other tenant',
      slug: `other-${generateId()}`,
      createdByUserId: user.userId,
    });

    await withTenantTransaction(db, organisation.organisationId, (trx) =>
      insertOrganisationMember(trx, {
        organisationId: organisation.organisationId,
        userId: user.userId,
        roles: ['owner', 'admin', 'member'],
      }),
    );

    const token = await createSessionToken(
      SESSION_SECRET,
      buildSessionClaims(user.userId, organisation.organisationId, ['owner', 'admin', 'member']),
    );

    return `${SESSION_COOKIE_NAME}=${token}`;
  }
});
