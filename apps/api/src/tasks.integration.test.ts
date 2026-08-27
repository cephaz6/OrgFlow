import {
  createDb,
  createOrganisation,
  createUserWithIdentity,
  findCaseTasksForCase,
  generateId,
  insertOrganisationMember,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import { createMongoClient, ensureIndexes } from '@orgflow/documents';
import { createDummyEmailSender } from '@orgflow/email';
import { createDummyFileStore } from '@orgflow/storage';
import { createDummyPublisher, type DummyDomainEventPublisher } from '@orgflow/events';
import type { OrganisationRole } from '@orgflow/types';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { buildSessionClaims, createSessionToken, SESSION_COOKIE_NAME } from './auth/session.js';
import { createLogger } from './logger.js';

const SESSION_SECRET = '33'.repeat(32);

describe('tasks API against real Postgres and Mongo', () => {
  let db: Kysely<Database>;
  let mongoClient: MongoClient;
  let publisher: DummyDomainEventPublisher;
  let organisationId: string;
  let devUserId: string;
  let definitionId: string;

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    mongoClient = await createMongoClient({ uri: process.env.ORGFLOW_TEST_MONGODB_URI! });
    await ensureIndexes(mongoClient);
    publisher = createDummyPublisher();

    // dev-login runs the seed, which is what creates the definition, the
    // IT Support group and the dev user's line manager.
    const agent = request.agent(buildApp());
    const login = await agent.post('/api/v1/auth/dev-login');
    expect(login.status).toBe(200);
    devUserId = login.body.user.userId;

    const session = await agent.get('/api/v1/auth/session');
    organisationId = session.body.organisationId;

    const catalogue = await agent.get('/api/v1/process-definitions');
    definitionId = catalogue.body.data.find(
      (entry: { key: string }) => entry.key === 'laptop-request',
    ).definitionId;
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
      emailSender: createDummyEmailSender(),
      fileStore: createDummyFileStore(),
      corsOrigin: 'http://localhost:3000',
      logger: createLogger('silent'),
      sessionSecret: SESSION_SECRET,
      isLocal: true,
      apiBaseUrl: 'http://localhost:4000',
    });
  }

  async function cookieFor(userId: string, roles: OrganisationRole[]): Promise<string> {
    const token = await createSessionToken(
      SESSION_SECRET,
      buildSessionClaims(userId, organisationId, roles),
    );
    return `${SESSION_COOKIE_NAME}=${token}`;
  }

  function devCookie() {
    return cookieFor(devUserId, ['owner', 'admin', 'processOwner', 'approver', 'member']);
  }

  function laptopValues(estimatedCost: number) {
    return {
      laptopModel: 'mbp14',
      estimatedCost,
      justification: 'The current machine no longer builds the project within a working day.',
      requiredBy: '2026-10-01',
    };
  }

  // Submits a laptop request at the given cost and returns the case plus the
  // manager task waiting on it.
  async function submitCase(estimatedCost: number) {
    const app = buildApp();
    const cookie = await devCookie();

    const created = await request(app)
      .post('/api/v1/cases')
      .set('Cookie', cookie)
      .send({ definitionId, values: laptopValues(estimatedCost) });
    expect(created.status).toBe(201);

    const submitted = await request(app)
      .post(`/api/v1/cases/${created.body.case.caseId}/submit`)
      .set('Cookie', cookie);
    expect(submitted.status).toBe(200);

    return {
      caseId: submitted.body.case.caseId as string,
      reference: submitted.body.case.reference as string,
      managerTask: submitted.body.tasks[0] as { taskId: string; assigneeUserId: string },
    };
  }

  async function decide(taskId: string, cookie: string, body: Record<string, unknown>) {
    return request(buildApp())
      .post(`/api/v1/tasks/${taskId}/decide`)
      .set('Cookie', cookie)
      .send(body);
  }

  it('lists an assigned task in the approver’s queue with its case context', async () => {
    const { caseId, reference, managerTask } = await submitCase(700);
    const managerCookie = await cookieFor(managerTask.assigneeUserId, ['member', 'approver']);

    const queue = await request(buildApp()).get('/api/v1/tasks').set('Cookie', managerCookie);

    expect(queue.status).toBe(200);
    const entry = queue.body.data.find((task: { caseId: string }) => task.caseId === caseId);
    expect(entry).toMatchObject({
      stepKey: 'managerApproval',
      status: 'pending',
      caseReference: reference,
      definitionId,
    });
    expect(entry.caseTitle).toBe('mbp14');
  });

  it('paginates the assigned queue without repeating or skipping a task', async () => {
    const cases = await Promise.all([submitCase(701), submitCase(702), submitCase(703)]);
    const managerCookie = await cookieFor(cases[0]!.managerTask.assigneeUserId, [
      'member',
      'approver',
    ]);

    const seen = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      const response = await request(buildApp())
        .get('/api/v1/tasks')
        .query({ limit: 2, ...(cursor ? { cursor } : {}) })
        .set('Cookie', managerCookie);
      expect(response.status).toBe(200);
      for (const task of response.body.data as Array<{ taskId: string }>) {
        expect(seen.has(task.taskId)).toBe(false);
        seen.add(task.taskId);
      }
      if (!response.body.hasMore) {
        break;
      }
      cursor = response.body.nextCursor as string;
    }

    for (const { managerTask } of cases) {
      expect(seen.has(managerTask.taskId)).toBe(true);
    }
  });

  it('finds an assigned task by a substring of its case reference', async () => {
    const { reference, managerTask } = await submitCase(704);
    const managerCookie = await cookieFor(managerTask.assigneeUserId, ['member', 'approver']);

    const found = await request(buildApp())
      .get('/api/v1/tasks')
      .query({ query: reference.slice(-4) })
      .set('Cookie', managerCookie);
    expect(found.status).toBe(200);
    expect(
      (found.body.data as Array<{ taskId: string }>).some((t) => t.taskId === managerTask.taskId),
    ).toBe(true);

    const notFound = await request(buildApp())
      .get('/api/v1/tasks')
      .query({ query: `no-such-reference-${generateId()}` })
      .set('Cookie', managerCookie);
    expect(notFound.status).toBe(200);
    expect(notFound.body.data).toEqual([]);
  });

  it('carries requester context on the decision screen', async () => {
    // PRD.md §13.2: the decision screen must hold everything needed to
    // decide, on one screen, without navigating away. Requester name,
    // department and line manager are named explicitly.
    const { managerTask } = await submitCase(700);
    const managerCookie = await cookieFor(managerTask.assigneeUserId, ['member', 'approver']);

    const detail = await request(buildApp())
      .get(`/api/v1/tasks/${managerTask.taskId}`)
      .set('Cookie', managerCookie);

    expect(detail.status).toBe(200);
    expect(detail.body.requester).toMatchObject({
      userId: devUserId,
      displayName: 'Local Dev User',
      email: 'dev@orgflow.local',
    });
    // The seed makes the dev manager the requester's line manager, and it
    // is the approver reading this screen, so it resolves to them.
    expect(detail.body.requester.lineManagerUserId).toBe(managerTask.assigneeUserId);
    expect(detail.body.case.submittedAt).toBeTruthy();
  });

  it('carries the requester on every queue row', async () => {
    const { caseId, managerTask } = await submitCase(700);
    const managerCookie = await cookieFor(managerTask.assigneeUserId, ['member', 'approver']);

    const queue = await request(buildApp()).get('/api/v1/tasks').set('Cookie', managerCookie);
    const entry = queue.body.data.find((task: { caseId: string }) => task.caseId === caseId);

    expect(entry.requesterName).toBe('Local Dev User');
    expect(entry.requesterUserId).toBe(devUserId);

    // The claimable pool carries it too, since PRD.md §13.2's queue row
    // applies to unclaimed work just as much.
    const approved = await decide(managerTask.taskId, managerCookie, { decision: 'approve' });
    const available = await request(buildApp())
      .get('/api/v1/tasks/available')
      .set('Cookie', await devCookie());
    const poolEntry = available.body.data.find(
      (task: { taskId: string }) => task.taskId === approved.body.tasks[0].taskId,
    );
    expect(poolEntry.requesterName).toBe('Local Dev User');
  });

  it('returns the task with the step definition from the pinned version', async () => {
    const { managerTask } = await submitCase(700);
    const managerCookie = await cookieFor(managerTask.assigneeUserId, ['member', 'approver']);

    const detail = await request(buildApp())
      .get(`/api/v1/tasks/${managerTask.taskId}`)
      .set('Cookie', managerCookie);

    expect(detail.status).toBe(200);
    expect(detail.body.canAct).toBe(true);
    expect(detail.body.step).toMatchObject({
      key: 'managerApproval',
      type: 'approval',
      allowedDecisions: ['approve', 'reject', 'return'],
      requireCommentOn: ['reject', 'return'],
    });
    expect(detail.body.values.estimatedCost).toBe(700);
  });

  // The conditional-branch proof, below the threshold: manager to IT, with
  // finance skipped entirely.
  it('routes a request below £1000 from manager straight to IT fulfilment', async () => {
    const { caseId, managerTask } = await submitCase(850);
    const managerCookie = await cookieFor(managerTask.assigneeUserId, ['member', 'approver']);

    const approved = await decide(managerTask.taskId, managerCookie, { decision: 'approve' });

    expect(approved.status).toBe(200);
    expect(approved.body.task.decision).toBe('approved');
    expect(approved.body.task.status).toBe('completed');
    expect(approved.body.case.currentStepKey).toBe('itFulfilment');
    expect(approved.body.tasks).toHaveLength(1);
    expect(approved.body.tasks[0]).toMatchObject({
      stepKey: 'itFulfilment',
      assignmentStrategy: 'group',
      assigneeUserId: null,
    });
    expect(approved.body.tasks[0].assigneeGroupId).toBeTruthy();

    // The losing branch is recorded too, so the timeline can explain why
    // finance was skipped.
    const timeline = await request(buildApp())
      .get(`/api/v1/cases/${caseId}/timeline`)
      .set('Cookie', await devCookie());
    const transition = timeline.body.data.find(
      (entry: { kind: string; toStepKey?: string }) =>
        entry.kind === 'transition' && entry.toStepKey === 'itFulfilment',
    );
    expect(transition.conditionResult.chosen).toBe('itFulfilment');
    expect(transition.conditionResult.evaluated[0]).toMatchObject({
      to: 'financeApproval',
      matched: false,
    });
  });

  // The same proof above the threshold: the finance step is inserted.
  it('inserts the finance step for a request above £1000', async () => {
    const { managerTask } = await submitCase(1500);
    const managerCookie = await cookieFor(managerTask.assigneeUserId, ['member', 'approver']);

    const approved = await decide(managerTask.taskId, managerCookie, { decision: 'approve' });

    expect(approved.status).toBe(200);
    expect(approved.body.case.currentStepKey).toBe('financeApproval');
    expect(approved.body.tasks[0]).toMatchObject({
      stepKey: 'financeApproval',
      assignmentStrategy: 'role',
      assigneeRole: 'approver',
      assigneeUserId: null,
    });
  });

  it('runs a below-threshold case end to end to $completed', async () => {
    const { caseId, managerTask } = await submitCase(600);
    const managerCookie = await cookieFor(managerTask.assigneeUserId, ['member', 'approver']);
    const cookie = await devCookie();

    const approved = await decide(managerTask.taskId, managerCookie, { decision: 'approve' });
    const fulfilmentTaskId = approved.body.tasks[0].taskId as string;

    // A group task starts unclaimed; the dev user is in IT Support.
    const claimed = await request(buildApp())
      .post(`/api/v1/tasks/${fulfilmentTaskId}/claim`)
      .set('Cookie', cookie)
      .send({});
    expect(claimed.status).toBe(200);
    expect(claimed.body.task.status).toBe('claimed');
    expect(claimed.body.task.assigneeUserId).toBe(devUserId);

    const completed = await decide(fulfilmentTaskId, cookie, {
      decision: 'complete',
      outputValues: { assetTag: 'ORG-LT-0042' },
    });

    expect(completed.status).toBe(200);
    expect(completed.body.case.status).toBe('completed');
    expect(completed.body.case.outcome).toBe('approved');
    expect(completed.body.case.currentStepKey).toBeNull();
    expect(completed.body.case.completedAt).toBeTruthy();

    // The output field is merged into the case values, so a later step or a
    // report can read it.
    const detail = await request(buildApp()).get(`/api/v1/cases/${caseId}`).set('Cookie', cookie);
    expect(detail.body.values.assetTag).toBe('ORG-LT-0042');

    const kinds = detail.body.timeline.map((entry: { kind: string }) => entry.kind);
    expect(kinds).toContain('decision');
    expect(
      detail.body.timeline.filter((e: { kind: string }) => e.kind === 'transition'),
    ).toHaveLength(3);
  });

  it('runs an above-threshold case end to end through finance to $completed', async () => {
    const { managerTask } = await submitCase(2400);
    const managerCookie = await cookieFor(managerTask.assigneeUserId, ['member', 'approver']);
    const cookie = await devCookie();

    const approved = await decide(managerTask.taskId, managerCookie, { decision: 'approve' });
    const financeTaskId = approved.body.tasks[0].taskId as string;

    // Role pools are actionable without claiming first: PRD.md §12.3 makes
    // a member of the assigned role actionable on an unclaimed task.
    const financeApproved = await decide(financeTaskId, cookie, { decision: 'approve' });
    expect(financeApproved.status).toBe(200);
    expect(financeApproved.body.case.currentStepKey).toBe('itFulfilment');

    const completed = await decide(financeApproved.body.tasks[0].taskId, cookie, {
      decision: 'complete',
      outputValues: { assetTag: 'ORG-LT-0099' },
    });
    expect(completed.body.case.status).toBe('completed');
    expect(completed.body.case.outcome).toBe('approved');
  });

  it('rejects a case, recording the reason and terminating it', async () => {
    const { managerTask } = await submitCase(900);
    const managerCookie = await cookieFor(managerTask.assigneeUserId, ['member', 'approver']);

    const rejected = await decide(managerTask.taskId, managerCookie, {
      decision: 'reject',
      comment: 'The existing laptop was replaced four months ago.',
    });

    expect(rejected.status).toBe(200);
    expect(rejected.body.case.status).toBe('rejected');
    expect(rejected.body.case.outcome).toBe('rejected');
    expect(rejected.body.task.comment).toBe('The existing laptop was replaced four months ago.');
    expect(rejected.body.tasks).toHaveLength(0);
  });

  it('returns a case to its requester, leaving it active with no current step', async () => {
    const { managerTask } = await submitCase(900);
    const managerCookie = await cookieFor(managerTask.assigneeUserId, ['member', 'approver']);

    const returned = await decide(managerTask.taskId, managerCookie, {
      decision: 'return',
      comment: 'Please attach a supplier quote before I can approve this.',
    });

    expect(returned.status).toBe(200);
    // PRD.md §6.3 step 5.
    expect(returned.body.case.status).toBe('active');
    expect(returned.body.case.currentStepKey).toBeNull();
    expect(returned.body.tasks[0]).toMatchObject({
      stepKey: '$returnedToRequester',
      assigneeUserId: devUserId,
    });
  });

  it('enforces the step’s allowed decisions and its required comments', async () => {
    const { managerTask } = await submitCase(900);
    const managerCookie = await cookieFor(managerTask.assigneeUserId, ['member', 'approver']);

    // 'complete' is not among managerApproval's allowed decisions.
    const notAllowed = await decide(managerTask.taskId, managerCookie, { decision: 'complete' });
    expect(notAllowed.status).toBe(409);

    // requireCommentOn: ['reject', 'return'].
    const noComment = await decide(managerTask.taskId, managerCookie, { decision: 'reject' });
    expect(noComment.status).toBe(409);

    // Neither refusal consumed the task, so it is still actionable.
    const stillOpen = await request(buildApp())
      .get(`/api/v1/tasks/${managerTask.taskId}`)
      .set('Cookie', managerCookie);
    expect(stillOpen.body.task.status).toBe('pending');
  });

  it('refuses a decision from somebody who is not the assignee', async () => {
    const { managerTask } = await submitCase(900);

    // The submitter is not the approver, even though they can see the case.
    const asSubmitter = await decide(managerTask.taskId, await devCookie(), {
      decision: 'approve',
    });

    expect(asSubmitter.status).toBe(403);
    expect(asSubmitter.headers['content-type']).toContain('application/problem+json');
  });

  it('refuses a second claim on an already-claimed pool task', async () => {
    const { managerTask } = await submitCase(700);
    const managerCookie = await cookieFor(managerTask.assigneeUserId, ['member', 'approver']);
    const approved = await decide(managerTask.taskId, managerCookie, { decision: 'approve' });
    const fulfilmentTaskId = approved.body.tasks[0].taskId as string;

    const first = await request(buildApp())
      .post(`/api/v1/tasks/${fulfilmentTaskId}/claim`)
      .set('Cookie', await devCookie())
      .send({});
    expect(first.status).toBe(200);

    const second = await request(buildApp())
      .post(`/api/v1/tasks/${fulfilmentTaskId}/claim`)
      .set('Cookie', await devCookie())
      .send({});
    expect(second.status).toBe(409);
  });

  it('refuses a decision on a task the case has already moved past', async () => {
    const { managerTask } = await submitCase(700);
    const managerCookie = await cookieFor(managerTask.assigneeUserId, ['member', 'approver']);

    expect((await decide(managerTask.taskId, managerCookie, { decision: 'approve' })).status).toBe(
      200,
    );

    const again = await decide(managerTask.taskId, managerCookie, { decision: 'approve' });
    expect(again.status).toBe(409);
  });

  it('offers a group task in the available pool only to its members', async () => {
    const { managerTask } = await submitCase(700);
    const managerCookie = await cookieFor(managerTask.assigneeUserId, ['member', 'approver']);
    const approved = await decide(managerTask.taskId, managerCookie, { decision: 'approve' });
    const fulfilmentTaskId = approved.body.tasks[0].taskId as string;

    const forMember = await request(buildApp())
      .get('/api/v1/tasks/available')
      .set('Cookie', await devCookie());
    expect(forMember.body.data.map((task: { taskId: string }) => task.taskId)).toContain(
      fulfilmentTaskId,
    );

    // An ordinary member in neither the group nor the approver role sees
    // nothing claimable.
    const outsider = await createMember(['member']);
    const forOutsider = await request(buildApp())
      .get('/api/v1/tasks/available')
      .set('Cookie', outsider.cookie);
    expect(forOutsider.body.data.map((task: { taskId: string }) => task.taskId)).not.toContain(
      fulfilmentTaskId,
    );
  });

  it('publishes task.decided, case.stepChanged and case.completed as the case advances', async () => {
    const { managerTask } = await submitCase(650);
    const managerCookie = await cookieFor(managerTask.assigneeUserId, ['member', 'approver']);

    publisher.clear();
    const approved = await decide(managerTask.taskId, managerCookie, { decision: 'approve' });
    let types = publisher.published.map((event) => event.eventType);
    expect(types).toContain('task.decided');
    expect(types).toContain('case.stepChanged');
    expect(types).toContain('task.created');
    // The approver, not the case's submitter, is the actor on their own
    // decision.
    const decided = publisher.published.find((event) => event.eventType === 'task.decided');
    expect(decided?.actorUserId).toBe(managerTask.assigneeUserId);

    publisher.clear();
    await decide(approved.body.tasks[0].taskId, await devCookie(), {
      decision: 'complete',
      outputValues: { assetTag: 'ORG-LT-0500' },
    });
    types = publisher.published.map((event) => event.eventType);
    expect(types).toContain('case.completed');
  });

  it('hides a case, and its tasks, from a member with no part in it', async () => {
    // PRD.md §12.3 visibility: sharing an organisation is not enough.
    const { caseId, managerTask } = await submitCase(700);
    const outsider = await createMember(['member']);

    const caseRead = await request(buildApp())
      .get(`/api/v1/cases/${caseId}`)
      .set('Cookie', outsider.cookie);
    expect(caseRead.status).toBe(404);

    const taskRead = await request(buildApp())
      .get(`/api/v1/tasks/${managerTask.taskId}`)
      .set('Cookie', outsider.cookie);
    expect(taskRead.status).toBe(404);

    // An admin in the same organisation may see it, which is the other half
    // of the same rule.
    const admin = await createMember(['member', 'admin']);
    const adminRead = await request(buildApp())
      .get(`/api/v1/cases/${caseId}`)
      .set('Cookie', admin.cookie);
    expect(adminRead.status).toBe(200);
  });

  it('returns 404, never 403, for another organisation’s task', async () => {
    const { managerTask } = await submitCase(700);
    const intruderCookie = await createOtherTenantSession();
    const app = buildApp();

    expect(
      (await request(app).get(`/api/v1/tasks/${managerTask.taskId}`).set('Cookie', intruderCookie))
        .status,
    ).toBe(404);

    expect(
      (
        await request(app)
          .post(`/api/v1/tasks/${managerTask.taskId}/claim`)
          .set('Cookie', intruderCookie)
          .send({})
      ).status,
    ).toBe(404);

    const decideAttempt = await request(app)
      .post(`/api/v1/tasks/${managerTask.taskId}/decide`)
      .set('Cookie', intruderCookie)
      .send({ decision: 'approve' });
    expect(decideAttempt.status).toBe(404);
    expect(decideAttempt.status).not.toBe(403);
  });

  it('requires a session on every task endpoint', async () => {
    const app = buildApp();

    expect((await request(app).get('/api/v1/tasks')).status).toBe(401);
    expect((await request(app).get('/api/v1/tasks/available')).status).toBe(401);
    expect((await request(app).post('/api/v1/tasks/whatever/claim').send({})).status).toBe(401);
  });

  it('leaves the case untouched when a decision is refused', async () => {
    const { caseId, managerTask } = await submitCase(900);
    const managerCookie = await cookieFor(managerTask.assigneeUserId, ['member', 'approver']);

    await decide(managerTask.taskId, managerCookie, { decision: 'reject' });

    // The rollback has to take the whole transaction with it, not just the
    // case row: no stray task, no stray transition.
    const tasks = await withTenantTransaction(db, organisationId, (trx) =>
      findCaseTasksForCase(trx, caseId),
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe('pending');
    expect(tasks[0]?.decision).toBeNull();
  });

  async function createMember(roles: OrganisationRole[]) {
    const user = await createUserWithIdentity(db, {
      email: `member-${generateId()}@example.invalid`,
      displayName: 'Another member',
      issuer: 'urn:orgflow:test',
      subject: `member-${generateId()}`,
    });

    await withTenantTransaction(db, organisationId, (trx) =>
      insertOrganisationMember(trx, { organisationId, userId: user.userId, roles }),
    );

    return { userId: user.userId, cookie: await cookieFor(user.userId, roles) };
  }

  async function createOtherTenantSession(): Promise<string> {
    const user = await createUserWithIdentity(db, {
      email: `intruder-${generateId()}@example.invalid`,
      displayName: 'Other tenant user',
      issuer: 'urn:orgflow:test',
      subject: `intruder-${generateId()}`,
    });

    const organisation = await createOrganisation(db, {
      name: 'Other tenant',
      slug: `other-tasks-${generateId()}`,
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
