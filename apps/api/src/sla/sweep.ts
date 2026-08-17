import { advance } from '@orgflow/core';
import {
  findCaseById,
  findCaseTaskById,
  findDueTimers,
  findProcessVersionById,
  generateId,
  markTimerFired,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import {
  findProcessDefinitionDocumentById,
  readCaseValues,
  verifyDocumentIntegrity,
} from '@orgflow/documents';
import type { DomainEventPublisher } from '@orgflow/events';
import type { DomainEvent, ProcessDefinitionDocument, SlaTimer } from '@orgflow/types';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';

import { buildEvaluationContext } from '../cases/evaluation-context.js';
import { persistEngineOutput } from '../cases/persist-engine-output.js';
import type { Logger } from '../logger.js';

export interface SlaSweepDeps {
  db: Kysely<Database>;
  mongoClient: MongoClient;
  publisher: DomainEventPublisher;
  logger: Logger;
}

// The production design PRD.md §15.2 specifies (a one-off EventBridge
// Scheduler schedule per timer, firing exactly at fireAt) needs AWS
// deployed to exist at all, and nothing is deployed yet (a separate,
// not-yet-started item). This is the swappable local substitute, in the
// same spirit as the dummy SES sender or the dummy SNS publisher: an
// interval poll over the sla_timers table those TimerSpecs already write
// to, so the eventual real implementation only replaces how a timer fires,
// never what happens once it does. 30 seconds is a local/dev value chosen
// for demos to be able to see a reminder or escalation land in a
// reasonable time, not a PRD requirement.
const DEFAULT_INTERVAL_MS = 30_000;

export interface SlaSweepHandle {
  stop: () => void;
}

export function startSlaSweep(
  deps: SlaSweepDeps,
  intervalMs = DEFAULT_INTERVAL_MS,
): SlaSweepHandle {
  const timer = setInterval(() => {
    void runSweepOnce(deps).catch((err) => {
      deps.logger.error({ err }, 'sla sweep iteration failed');
    });
  }, intervalMs);

  // Never blocks the process from exiting; a sweep tick already in flight
  // when the process is asked to stop is left to finish on its own
  // connection, not aborted mid-write.
  timer.unref?.();

  return { stop: () => clearInterval(timer) };
}

export async function runSweepOnce(deps: SlaSweepDeps): Promise<void> {
  const due = await findDueTimers(deps.db, new Date());

  for (const timer of due) {
    try {
      await processTimer(deps, timer);
    } catch (err) {
      // One bad timer must not stop the rest of the batch from being
      // processed, and must not leave the sweep permanently stuck on it:
      // it stays 'scheduled' and is retried on the next tick.
      deps.logger.error({ err, timerId: timer.timerId }, 'failed to process an sla timer');
    }
  }
}

async function processTimer(deps: SlaSweepDeps, timer: SlaTimer): Promise<void> {
  const events =
    timer.timerType === 'reminder'
      ? await processReminder(deps, timer)
      : await processEscalation(deps, timer);

  await withTenantTransaction(deps.db, timer.organisationId, (trx) =>
    markTimerFired(trx, timer.timerId),
  );

  if (events.length > 0) {
    await deps.publisher.publish(events);
  }
}

function buildEvent(
  organisationId: string,
  eventType: DomainEvent['eventType'],
  payload: Record<string, unknown>,
  suffix: string,
): DomainEvent {
  return {
    eventId: `${suffix}`,
    eventType,
    organisationId,
    occurredAt: new Date().toISOString(),
    actorUserId: null,
    actorType: 'scheduler',
    correlationId: generateId(),
    payload,
    schemaVersion: 1,
  };
}

// A reminder never changes case state (PRD.md §15.2's `reminder` type is
// purely informational), so this does not touch the engine at all: it
// reads the task, and publishes directly. workers/ picks it up the same
// way it already picks up task.created.
async function processReminder(deps: SlaSweepDeps, timer: SlaTimer): Promise<DomainEvent[]> {
  if (!timer.taskId) {
    return [];
  }

  const task = await withTenantTransaction(deps.db, timer.organisationId, (trx) =>
    findCaseTaskById(trx, timer.taskId!),
  );

  // The task this timer was scheduled for was decided (or the case
  // terminated) since it was scheduled. Its timers should have been
  // cancelled at that point (persistEngineOutput); this is the fallback for
  // any that were not, rather than reminding someone about finished work.
  if (!task || task.status !== 'pending') {
    return [];
  }

  return [
    buildEvent(
      timer.organisationId,
      'task.reminderDue',
      {
        caseId: task.caseId,
        taskId: task.taskId,
        stepKey: task.stepKey,
        assigneeUserId: task.assigneeUserId,
        assigneeRole: task.assigneeRole,
        assigneeGroupId: task.assigneeGroupId,
        dueAt: task.dueAt,
      },
      `${timer.timerId}:reminder`,
    ),
  ];
}

async function loadPinnedDocument(
  deps: SlaSweepDeps,
  organisationId: string,
  versionId: string,
): Promise<ProcessDefinitionDocument | null> {
  const version = await withTenantTransaction(deps.db, organisationId, (trx) =>
    findProcessVersionById(trx, versionId),
  );
  if (!version) {
    return null;
  }

  const document = await findProcessDefinitionDocumentById(
    deps.mongoClient,
    organisationId,
    version.documentId,
  );
  if (!document || !verifyDocumentIntegrity(document, version.documentHash)) {
    return null;
  }

  return document;
}

// Runs the timer's task through the engine's escalationTriggered handling,
// the same shape POST /tasks/:taskId/decide already uses for a real
// decision: load the pinned document and values, build an evaluation
// context, call advance(), persist whatever it returns.
async function processEscalation(deps: SlaSweepDeps, timer: SlaTimer): Promise<DomainEvent[]> {
  if (!timer.taskId) {
    return [];
  }

  const outcome = await withTenantTransaction(deps.db, timer.organisationId, async (trx) => {
    const task = await findCaseTaskById(trx, timer.taskId!);
    if (!task || task.status !== 'pending') {
      return null;
    }

    const found = await findCaseById(trx, task.caseId);
    // The case moved on from this step (or terminated) since the timer was
    // scheduled; its timers should already have been cancelled, and this
    // is the same defensive fallback processReminder has.
    if (!found || found.status !== 'active' || found.currentStepKey !== task.stepKey) {
      return null;
    }

    const document = await loadPinnedDocument(deps, timer.organisationId, found.versionId);
    if (!document) {
      return null;
    }

    const values = await readCaseValues(deps.mongoClient, timer.organisationId, found.caseId);
    const correlationId = generateId();

    const context = await buildEvaluationContext(trx, {
      submitterUserId: found.submittedByUserId,
      correlationId,
      now: new Date(),
      existingCase: found,
      escalationLevel: task.escalationLevel,
      ...(task.assigneeUserId ? { currentAssigneeUserId: task.assigneeUserId } : {}),
    });

    const output = advance({
      definition: document,
      caseState: {
        caseId: found.caseId,
        definitionId: found.definitionId,
        versionId: found.versionId,
        status: found.status,
        outcome: found.outcome,
        currentStepKey: found.currentStepKey,
      },
      values,
      event: { type: 'escalationTriggered', taskId: task.taskId },
      context,
    });

    if (
      output.errors.some((error) => error.code === 'noCurrentStep' || error.code === 'unknownStep')
    ) {
      // Structural refusals, not "nobody could be found": the case has
      // moved past this step in a way the guards above did not already
      // catch. Nothing to persist.
      return null;
    }

    const persisted = await persistEngineOutput(trx, {
      organisationId: timer.organisationId,
      // Nobody acted; the scheduler did. actorUserId stays null and
      // actorType records 'scheduler' on the audit row, the transition, and
      // every emitted event, rather than misattributing this to the
      // requester.
      actorUserId: null,
      actorType: 'scheduler',
      correlationId,
      existingCase: found,
      output,
      auditAction: output.errors.some((error) => error.code === 'escalationLevelsExhausted')
        ? 'case.escalationExhausted'
        : 'task.escalated',
    });

    return persisted.events;
  });

  return outcome ?? [];
}
