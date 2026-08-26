import {
  createDb,
  createOrganisation,
  createProcessVersion,
  createUserWithIdentity,
  findCaseTasksForCase,
  findCaseTransitionsForCase,
  generateId,
  insertOrganisationMember,
  publishProcessVersion,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import {
  buildLaptopRequestDefinition,
  createMongoClient,
  ensureIndexes,
  insertProcessDefinitionDocument,
} from '@orgflow/documents';
import { createDummyEmailSender } from '@orgflow/email';
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
      emailSender: createDummyEmailSender(),
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

    const patched = await agent.patch(`/api/v1/cases/${draft.caseId}`).send({
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

  it('finds a submitted case by a substring of its reference', async () => {
    const agent = await signInAsDevUser();
    const draft = await createDraft(agent, laptopValues(850));
    const submitted = await agent.post(`/api/v1/cases/${draft.caseId}/submit`);
    const reference = submitted.body.case.reference as string;

    const found = await agent
      .get('/api/v1/cases')
      .query({ view: 'mine', query: reference.slice(-4) });
    expect(found.status).toBe(200);
    expect(
      (found.body.data as Array<{ reference: string }>).some((c) => c.reference === reference),
    ).toBe(true);

    const notFound = await agent
      .get('/api/v1/cases')
      .query({ view: 'mine', query: `no-such-reference-${generateId()}` });
    expect(notFound.status).toBe(200);
    expect(notFound.body.data).toEqual([]);
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

  it('resubmits a returned case without re-pinning its version', async () => {
    const agent = await signInAsDevUser();
    const session = await agent.get('/api/v1/auth/session');
    const organisationId = session.body.organisationId as string;

    const draft = await createDraft(agent, laptopValues(850));
    const submitted = await agent.post(`/api/v1/cases/${draft.caseId}/submit`);
    const pinnedVersionId = submitted.body.case.versionId as string;
    const reference = submitted.body.case.reference as string;

    const managerTask = submitted.body.tasks[0];
    const managerCookie = `${SESSION_COOKIE_NAME}=${await createSessionToken(
      SESSION_SECRET,
      buildSessionClaims(managerTask.assigneeUserId, organisationId, ['member', 'approver']),
    )}`;

    const returned = await request(buildApp())
      .post(`/api/v1/tasks/${managerTask.taskId}/decide`)
      .set('Cookie', managerCookie)
      .send({ decision: 'return', comment: 'Please attach a supplier quote.' });
    expect(returned.status).toBe(200);
    expect(returned.body.case.currentStepKey).toBeNull();

    const resubmitted = await agent
      .post(`/api/v1/cases/${draft.caseId}/resubmit`)
      .send({ values: { ...laptopValues(850), justification: 'Quote attached, as requested.' } });

    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.case.currentStepKey).toBe('managerApproval');
    expect(resubmitted.body.case.status).toBe('active');

    // PRD.md §8.4, the property this endpoint exists to protect: a returned
    // case never silently upgrades, because the requester is amending
    // against the form they saw.
    expect(resubmitted.body.case.versionId).toBe(pinnedVersionId);
    // ADR-0013: the reference was allocated at first submission and is not
    // reissued.
    expect(resubmitted.body.case.reference).toBe(reference);

    const detail = await agent.get(`/api/v1/cases/${draft.caseId}`);
    expect(detail.body.values.justification).toBe('Quote attached, as requested.');

    // The amendment task is closed, not left outstanding in the requester's
    // queue as work they have already done.
    const returnedTask = detail.body.tasks.find(
      (task: { stepKey: string }) => task.stepKey === '$returnedToRequester',
    );
    expect(returnedTask.status).toBe('completed');
    expect(returnedTask.decision).toBe('completed');

    // A fresh manager task exists for the new pass.
    const openTasks = detail.body.tasks.filter(
      (task: { status: string }) => task.status === 'pending',
    );
    expect(openTasks).toHaveLength(1);
    expect(openTasks[0].stepKey).toBe('managerApproval');
  });

  it('keeps the original pin even when a newer version has been published', async () => {
    // The sharper half of PRD.md §8.4. Submit, return, publish a second
    // version, then resubmit: the case must still execute the version it
    // was submitted against, not the one that is current now.
    const agent = await signInAsDevUser();
    const session = await agent.get('/api/v1/auth/session');
    const organisationId = session.body.organisationId as string;
    const definition = await definitionId(agent);

    const draft = await createDraft(agent, laptopValues(850));
    const submitted = await agent.post(`/api/v1/cases/${draft.caseId}/submit`);
    const pinnedVersionId = submitted.body.case.versionId as string;

    const managerTask = submitted.body.tasks[0];
    const managerCookie = `${SESSION_COOKIE_NAME}=${await createSessionToken(
      SESSION_SECRET,
      buildSessionClaims(managerTask.assigneeUserId, organisationId, ['member', 'approver']),
    )}`;
    await request(buildApp())
      .post(`/api/v1/tasks/${managerTask.taskId}/decide`)
      .set('Cookie', managerCookie)
      .send({ decision: 'return', comment: 'Needs a quote.' });

    // Publish version 2 of the same definition, so current_version_id moves.
    const stored = await insertProcessDefinitionDocument(
      mongoClient,
      buildLaptopRequestDefinition({
        organisationId,
        definitionId: definition,
        createdByUserId: session.body.user.userId as string,
        createdAt: new Date().toISOString(),
      }),
    );
    const newVersionId = await withTenantTransaction(db, organisationId, async (trx) => {
      const version = await createProcessVersion(trx, {
        organisationId,
        definitionId: definition,
        versionNumber: 2,
        documentId: stored.documentId,
        documentHash: stored.documentHash,
      });
      await publishProcessVersion(trx, version.versionId, session.body.user.userId as string);
      return version.versionId;
    });
    expect(newVersionId).not.toBe(pinnedVersionId);

    const resubmitted = await agent.post(`/api/v1/cases/${draft.caseId}/resubmit`).send({});

    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.case.versionId).toBe(pinnedVersionId);
    expect(resubmitted.body.case.versionId).not.toBe(newVersionId);

    // A case submitted after the publish does pin the new one, which is
    // what makes the assertion above meaningful rather than vacuous.
    const laterDraft = await createDraft(agent, laptopValues(300));
    const laterSubmitted = await agent.post(`/api/v1/cases/${laterDraft.caseId}/submit`);
    expect(laterSubmitted.body.case.versionId).toBe(newVersionId);
  });

  it('returns the pinned definition document, not the current one', async () => {
    // The case detail labels its answers from this document. Serving the
    // current version instead would describe a case using questions it was
    // never asked, the moment somebody publishes a new version.
    const agent = await signInAsDevUser();
    const session = await agent.get('/api/v1/auth/session');
    const organisationId = session.body.organisationId as string;
    const definition = await definitionId(agent);

    // Read the current version number rather than assuming 1: these files
    // share one database, and an earlier test in this file already
    // publishes a second version of this same definition.
    const before = await agent.get(`/api/v1/process-definitions/${definition}`);
    const nextVersionNumber = (before.body.version.versionNumber as number) + 1;

    // Identity is asserted through the document's *content*, not its
    // versionNumber field. buildLaptopRequestDefinition always stamps 1, so
    // in this shared database that field does not reliably match the
    // process_versions row it is attached to. The form is what a reader of
    // the case detail actually sees, which makes it the right thing to
    // assert on regardless.
    const fieldKeysOf = (document: { form: { sections: { fields: { key: string }[] }[] } }) =>
      document.form.sections.flatMap((section) => section.fields.map((field) => field.key));

    const draft = await createDraft(agent, laptopValues(850));
    const submitted = await agent.post(`/api/v1/cases/${draft.caseId}/submit`);
    const pinnedVersionId = submitted.body.case.versionId as string;

    const beforePublish = await agent.get(`/api/v1/cases/${draft.caseId}`);
    expect(beforePublish.status).toBe(200);
    expect(fieldKeysOf(beforePublish.body.document)).not.toContain('costCentre');

    // The next version carries a field the pinned one does not, so the two
    // documents are distinguishable by content and not only by number.
    const nextDocument = buildLaptopRequestDefinition({
      organisationId,
      definitionId: definition,
      createdByUserId: session.body.user.userId as string,
      createdAt: new Date().toISOString(),
    });
    nextDocument.versionNumber = nextVersionNumber;
    nextDocument.form.sections[0]!.fields.push({
      key: 'costCentre',
      type: 'text',
      label: 'Cost centre',
      required: true,
    });
    const stored = await insertProcessDefinitionDocument(mongoClient, nextDocument);

    await withTenantTransaction(db, organisationId, async (trx) => {
      const version = await createProcessVersion(trx, {
        organisationId,
        definitionId: definition,
        versionNumber: nextVersionNumber,
        documentId: stored.documentId,
        documentHash: stored.documentHash,
      });
      await publishProcessVersion(trx, version.versionId, session.body.user.userId as string);
    });

    const afterPublish = await agent.get(`/api/v1/cases/${draft.caseId}`);
    expect(afterPublish.status).toBe(200);
    expect(afterPublish.body.case.versionId).toBe(pinnedVersionId);
    expect(fieldKeysOf(afterPublish.body.document)).not.toContain('costCentre');

    // A case submitted now does get the new document, which is what stops
    // the assertion above passing for the wrong reason.
    const laterDraft = await createDraft(agent, laptopValues(300));
    await agent.post(`/api/v1/cases/${laterDraft.caseId}/submit`);
    const laterDetail = await agent.get(`/api/v1/cases/${laterDraft.caseId}`);
    expect(fieldKeysOf(laterDetail.body.document)).toContain('costCentre');
  });

  it('refuses to resubmit a case that was never returned', async () => {
    const agent = await signInAsDevUser();
    const draft = await createDraft(agent, laptopValues(850));

    // A draft is not a returned case.
    expect((await agent.post(`/api/v1/cases/${draft.caseId}/resubmit`).send({})).status).toBe(409);

    // Nor is one sitting on an open step.
    await agent.post(`/api/v1/cases/${draft.caseId}/submit`);
    expect((await agent.post(`/api/v1/cases/${draft.caseId}/resubmit`).send({})).status).toBe(409);
  });

  it('cancels a case with a reason, terminating it and cancelling open tasks', async () => {
    const agent = await signInAsDevUser();
    const draft = await createDraft(agent, laptopValues(850));
    const submitted = await agent.post(`/api/v1/cases/${draft.caseId}/submit`);
    expect(submitted.body.tasks[0].status).toBe('pending');
    publisher.clear();

    const cancelled = await agent
      .post(`/api/v1/cases/${draft.caseId}/cancel`)
      .send({ reason: 'Ordered through the existing hardware refresh instead.' });

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.case.status).toBe('cancelled');
    expect(cancelled.body.case.outcome).toBe('cancelled');
    expect(cancelled.body.case.completedAt).toBeTruthy();

    const detail = await agent.get(`/api/v1/cases/${draft.caseId}`);
    expect(detail.body.tasks.every((task: { status: string }) => task.status === 'cancelled')).toBe(
      true,
    );

    // PRD.md §10 puts the reason on the case.cancelled payload, which the
    // engine cannot supply because nothing in the state machine reads it.
    const event = publisher.published.find((candidate) => candidate.eventType === 'case.cancelled');
    expect(event?.payload.reason).toBe('Ordered through the existing hardware refresh instead.');

    const audit = detail.body.timeline.find(
      (entry: { kind: string; action?: string }) =>
        entry.kind === 'audit' && entry.action === 'case.cancelled',
    );
    expect(audit.payload.reason).toBe('Ordered through the existing hardware refresh instead.');
  });

  it('requires a reason to cancel, and refuses to cancel a terminal case', async () => {
    const agent = await signInAsDevUser();
    const draft = await createDraft(agent, laptopValues(850));
    await agent.post(`/api/v1/cases/${draft.caseId}/submit`);

    expect((await agent.post(`/api/v1/cases/${draft.caseId}/cancel`).send({})).status).toBe(400);

    await agent.post(`/api/v1/cases/${draft.caseId}/cancel`).send({ reason: 'No longer needed.' });
    const again = await agent
      .post(`/api/v1/cases/${draft.caseId}/cancel`)
      .send({ reason: 'Again.' });
    expect(again.status).toBe(409);
  });

  it('serves the same definition detail by key as by id', async () => {
    const agent = await signInAsDevUser();
    const id = await definitionId(agent);

    const byId = await agent.get(`/api/v1/process-definitions/${id}`);
    const byKey = await agent.get('/api/v1/process-definitions/by-key/laptop-request');

    expect(byKey.status).toBe(200);
    expect(byKey.body).toEqual(byId.body);

    expect((await agent.get('/api/v1/process-definitions/by-key/no-such-process')).status).toBe(
      404,
    );
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
