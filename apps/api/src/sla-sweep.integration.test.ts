import { createDb, findCaseTasksForCase, withTenantTransaction, type Database } from '@orgflow/db';
import { createMongoClient, ensureIndexes } from '@orgflow/documents';
import { createDummyEmailSender } from '@orgflow/email';
import { createDummyFileStore } from '@orgflow/storage';
import { createDummyPublisher, type DummyDomainEventPublisher } from '@orgflow/events';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { createLogger } from './logger.js';
import { runSweepOnce } from './sla/sweep.js';

// The Laptop Request seed's managerApproval step (packages/documents/src
// /seed/laptop-request.ts) carries a real SLA: a reminder at 12 hours
// before the 48-hour deadline, and escalation to lineManagerOfAssignee at
// 24 hours after, falling through to role: processOwner at 72 hours. Rather
// than waiting real hours for a timer to become due, these tests backdate
// the persisted sla_timers row's fire_at directly, the same fast-forward a
// real EventBridge Scheduler swap would not need but a 30-second local poll
// cannot otherwise be exercised on demand. Everything past that point,
// findDueTimers, the sweep, advance(), persistEngineOutput, runs for real.
describe('the SLA sweep against real Postgres and Mongo', () => {
  let db: Kysely<Database>;
  let mongoClient: MongoClient;
  let publisher: DummyDomainEventPublisher;
  let organisationId: string;
  let definitionId: string;

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    mongoClient = await createMongoClient({ uri: process.env.ORGFLOW_TEST_MONGODB_URI! });
    await ensureIndexes(mongoClient);
    publisher = createDummyPublisher();

    const agent = request.agent(buildApp());
    const login = await agent.post('/api/v1/auth/dev-login');
    expect(login.status).toBe(200);

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
      sessionSecret: '44'.repeat(32),
      isLocal: true,
      apiBaseUrl: 'http://localhost:4000',
    });
  }

  function laptopValues(estimatedCost: number) {
    return {
      laptopModel: 'mbp14',
      estimatedCost,
      justification: 'The current machine no longer builds the project within a working day.',
      requiredBy: '2026-10-01',
    };
  }

  async function submitCase() {
    const agent = request.agent(buildApp());
    await agent.post('/api/v1/auth/dev-login');

    const created = await agent
      .post('/api/v1/cases')
      .send({ definitionId, values: laptopValues(700) });
    expect(created.status).toBe(201);

    const submitted = await agent.post(`/api/v1/cases/${created.body.case.caseId}/submit`);
    expect(submitted.status).toBe(200);

    return {
      caseId: submitted.body.case.caseId as string,
      managerTask: submitted.body.tasks[0] as { taskId: string; assigneeUserId: string },
    };
  }

  // Directly ages a timer past due, inside the case's own tenant
  // transaction, the same as every other mutation in this schema.
  // escalationLevel narrows to a single one of the step's two escalation
  // timers (they fire 48 hours apart in real time): backdating only the
  // first exercises one escalation the way it actually happens, rather than
  // both timers firing in the same sweep pass, which is its own scenario
  // (a duplicate-firing guard, not what this file is testing).
  async function backdateTimer(
    taskId: string,
    timerType: 'reminder' | 'escalation',
    escalationLevel?: number,
  ): Promise<void> {
    await withTenantTransaction(db, organisationId, (trx) => {
      let query = trx
        .updateTable('sla_timers')
        .set({ fire_at: new Date(Date.now() - 60_000) })
        .where('task_id', '=', taskId)
        .where('timer_type', '=', timerType)
        .where('status', '=', 'scheduled');
      if (escalationLevel !== undefined) {
        query = query.where('escalation_level', '=', escalationLevel);
      }
      return query.execute();
    });
  }

  it('fires a reminder without changing case or task state', async () => {
    const { caseId, managerTask } = await submitCase();
    await backdateTimer(managerTask.taskId, 'reminder');

    await runSweepOnce({ db, mongoClient, publisher, logger: createLogger('silent') });

    const published = publisher.published;
    const reminder = published.find(
      (event) =>
        event.eventType === 'task.reminderDue' && event.payload.taskId === managerTask.taskId,
    );
    expect(reminder).toBeDefined();
    expect(reminder?.actorType).toBe('scheduler');

    const tasks = await withTenantTransaction(db, organisationId, (trx) =>
      findCaseTasksForCase(trx, caseId),
    );
    // A reminder is purely informational (PRD.md §15.2): the task the
    // reminder was about is still exactly as it was, still the only task on
    // the case.
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe('pending');
    expect(tasks[0]?.escalationLevel).toBe(0);

    const timer = await withTenantTransaction(db, organisationId, (trx) =>
      trx
        .selectFrom('sla_timers')
        .selectAll()
        .where('task_id', '=', managerTask.taskId)
        .where('timer_type', '=', 'reminder')
        .executeTakeFirstOrThrow(),
    );
    expect(timer.status).toBe('fired');
  });

  it('creates an additional task on escalation, leaving the original one open', async () => {
    const { caseId, managerTask } = await submitCase();
    await backdateTimer(managerTask.taskId, 'escalation', 1);

    await runSweepOnce({ db, mongoClient, publisher, logger: createLogger('silent') });

    const tasks = await withTenantTransaction(db, organisationId, (trx) =>
      findCaseTasksForCase(trx, caseId),
    );

    // PRD.md §15.3: escalation adds an assignee, it never replaces one. The
    // original manager task stays pending; a second task appears on the
    // same step. lineManagerOfAssignee (level 1) has nobody to resolve to
    // (the seeded manager has no line manager of their own recorded), so
    // this falls through to role: processOwner (level 2) in one call.
    expect(tasks).toHaveLength(2);

    const original = tasks.find((task) => task.taskId === managerTask.taskId);
    expect(original?.status).toBe('pending');
    // Stamped with the level this escalation resolved to (see
    // markTaskEscalated), so a later timer for the same task resumes past
    // it instead of re-walking the rule list from level 1.
    expect(original?.escalationLevel).toBe(2);

    const escalated = tasks.find((task) => task.taskId !== managerTask.taskId);
    expect(escalated?.stepKey).toBe('managerApproval');
    expect(escalated?.status).toBe('pending');
    expect(escalated?.escalationLevel).toBe(2);
    expect(escalated?.assignmentStrategy).toBe('role');
    expect(escalated?.assigneeRole).toBe('processOwner');

    const published = publisher.published;
    const escalatedEvent = published.find((event) => event.eventType === 'task.escalated');
    expect(escalatedEvent).toBeDefined();
    expect(escalatedEvent?.actorType).toBe('scheduler');
    expect(escalatedEvent?.payload.escalationLevel).toBe(2);
  });

  it('does not create a duplicate task when a stale second escalation timer fires for an already-escalated task', async () => {
    // Both of the step's escalation timers due at once (not how they fire
    // in real operation, 48 hours apart, but exactly what a sweep that was
    // down for a while, or a retried delivery, would present it with).
    // Without markTaskEscalated recording where the first firing landed,
    // the second would re-walk from level 1 and create a second level-2
    // task alongside the first.
    const { caseId, managerTask } = await submitCase();
    await backdateTimer(managerTask.taskId, 'escalation', 1);
    await backdateTimer(managerTask.taskId, 'escalation', 2);

    await runSweepOnce({ db, mongoClient, publisher, logger: createLogger('silent') });

    const tasks = await withTenantTransaction(db, organisationId, (trx) =>
      findCaseTasksForCase(trx, caseId),
    );

    const escalatedTasks = tasks.filter((task) => task.taskId !== managerTask.taskId);
    expect(escalatedTasks).toHaveLength(1);

    // The second, now-redundant timer finds nothing further to escalate to
    // (only two levels are configured) and the case is flagged for
    // administrative attention rather than silently doing nothing.
    const updatedCase = await withTenantTransaction(db, organisationId, (trx) =>
      trx
        .selectFrom('cases')
        .select('status')
        .where('case_id', '=', caseId)
        .executeTakeFirstOrThrow(),
    );
    expect(updatedCase.status).toBe('unassigned');
  });
});
