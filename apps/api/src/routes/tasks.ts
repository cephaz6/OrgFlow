import { advance } from '@orgflow/core';
import {
  claimCaseTask,
  findCaseById,
  findCaseTaskById,
  findClaimableTaskQueue,
  findOrganisationMemberByUserId,
  findProcessVersionById,
  findTaskQueueForAssignee,
  findUserById,
  recordTaskDecision,
  TaskConcurrencyError,
  withTenantTransaction,
  type Database,
  type TaskQueueEntry,
} from '@orgflow/db';
import {
  findProcessDefinitionDocumentById,
  readCaseValues,
  upsertCaseValues,
  verifyDocumentIntegrity,
} from '@orgflow/documents';
import type { DomainEventPublisher } from '@orgflow/events';
import type {
  CaseTask,
  ProcessDefinitionDocument,
  TaskDecision,
  TaskStatus,
  WorkflowDecisionAction,
} from '@orgflow/types';
import { Router } from 'express';
import type { Kysely, Transaction } from 'kysely';
import type { MongoClient } from 'mongodb';
import { z } from 'zod';

import { buildEvaluationContext } from '../cases/evaluation-context.js';
import { canActOnTask, canViewCase, resolveClaimablePools } from '../cases/permissions.js';
import { persistEngineOutput } from '../cases/persist-engine-output.js';
import { parseBody } from '../lib/parse-body.js';
import type { Logger } from '../logger.js';
import { HttpProblemError } from '../middleware/error-handler.js';
import { requireSession, sessionOf } from '../middleware/require-session.js';

export interface TasksDeps {
  db: Kysely<Database>;
  mongoClient: MongoClient;
  publisher: DomainEventPublisher;
  sessionSecret: string;
  logger: Logger;
}

const TASK_STATUSES: TaskStatus[] = [
  'pending',
  'claimed',
  'completed',
  'skipped',
  'reassigned',
  'cancelled',
  'expired',
];

// packages/types keeps these two apart deliberately: the present-tense
// action a user takes, and the past-tense outcome recorded against the
// task. This is the single place the one becomes the other.
const DECISION_OUTCOMES: Record<WorkflowDecisionAction, TaskDecision> = {
  approve: 'approved',
  reject: 'rejected',
  return: 'returned',
  complete: 'completed',
};

const decideSchema = z.object({
  decision: z.enum(['approve', 'reject', 'return', 'complete']),
  comment: z.string().max(4000).optional(),
  outputValues: z.record(z.unknown()).optional(),
});

const claimSchema = z
  .object({
    // Optional: a client that read the task can assert the version it saw,
    // and a client that did not simply takes whatever is current. Either
    // way the UPDATE is version-checked, so two claimants cannot both win.
    rowVersion: z.number().int().positive().optional(),
  })
  .optional();

function toQueueResponse(entry: TaskQueueEntry) {
  return {
    ...entry.task,
    caseReference: entry.caseReference,
    caseTitle: entry.caseTitle,
    definitionId: entry.definitionId,
    // PRD.md §13.2 puts the requester on every approval queue row.
    requesterUserId: entry.requesterUserId,
    requesterName: entry.requesterName,
  };
}

// Cross-tenant task ids arrive as null, because RLS hid the row, so this
// is a 404 exactly as PRD.md §11.10 requires.
async function requireTask(trx: Transaction<Database>, taskId: string): Promise<CaseTask> {
  const task = await findCaseTaskById(trx, taskId);
  if (!task) {
    throw new HttpProblemError(404, 'Not Found', 'No such task.');
  }
  return task;
}

async function loadPinnedDocument(
  trx: Transaction<Database>,
  mongoClient: MongoClient,
  organisationId: string,
  versionId: string,
): Promise<ProcessDefinitionDocument> {
  const version = await findProcessVersionById(trx, versionId);
  if (!version) {
    throw new HttpProblemError(
      500,
      'Internal Server Error',
      'The case is pinned to a version that does not exist.',
    );
  }

  const document = await findProcessDefinitionDocumentById(
    mongoClient,
    organisationId,
    version.documentId,
  );
  if (!document) {
    throw new HttpProblemError(
      500,
      'Internal Server Error',
      'The pinned version references a definition document that does not exist.',
    );
  }
  if (!verifyDocumentIntegrity(document, version.documentHash)) {
    throw new HttpProblemError(
      500,
      'Internal Server Error',
      'The pinned definition document does not match the hash recorded when it was published.',
    );
  }

  return document;
}

export function createTasksRouter(deps: TasksDeps): Router {
  const router = Router();

  router.use('/tasks', requireSession(deps.sessionSecret));

  // PRD.md §11.6: assigned to the current user. Filters: status, overdue,
  // definitionId.
  router.get('/tasks', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const filter = parseQueueFilter(req.query);

      const entries = await withTenantTransaction(deps.db, session.organisationId, (trx) =>
        findTaskQueueForAssignee(trx, session.userId, filter),
      );

      res.status(200).json({ data: entries.map(toQueueResponse) });
    } catch (err) {
      next(err);
    }
  });

  // PRD.md §11.6: the claimable pool. Registered before /tasks/:taskId so
  // "available" is never read as an id.
  router.get('/tasks/available', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const filter = parseQueueFilter(req.query);

      const entries = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        const pools = await resolveClaimablePools(trx, session.userId);
        return findClaimableTaskQueue(trx, pools.roles, pools.groupIds, filter);
      });

      res.status(200).json({ data: entries.map(toQueueResponse) });
    } catch (err) {
      next(err);
    }
  });

  // PRD.md §11.6: the task with full case context.
  router.get('/tasks/:taskId', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const taskId = req.params.taskId!;

      const result = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        const task = await requireTask(trx, taskId);
        const found = await findCaseById(trx, task.caseId);
        if (!found) {
          throw new HttpProblemError(404, 'Not Found', 'No such task.');
        }

        // Seeing the task means seeing the case behind it, so the case
        // visibility rule governs, not the narrower actionability one:
        // PRD.md §12.3 keeps those two questions separate.
        if (!(await canViewCase(trx, session, found))) {
          throw new HttpProblemError(404, 'Not Found', 'No such task.');
        }

        const document = await loadPinnedDocument(
          trx,
          deps.mongoClient,
          session.organisationId,
          found.versionId,
        );
        const step = document.workflow.steps.find((candidate) => candidate.key === task.stepKey);
        const actionability = await canActOnTask(trx, session, task);

        // PRD.md §13.2: the decision screen must carry requester context, so
        // an approver has everything needed to decide on one screen without
        // navigating away.
        const [requesterUser, requesterMember] = await Promise.all([
          findUserById(deps.db, found.submittedByUserId),
          findOrganisationMemberByUserId(trx, found.submittedByUserId),
        ]);

        return { task, found, step, actionability, requesterUser, requesterMember };
      });

      const values = await readCaseValues(
        deps.mongoClient,
        session.organisationId,
        result.found.caseId,
      );

      res.status(200).json({
        task: result.task,
        case: {
          caseId: result.found.caseId,
          reference: result.found.reference,
          title: result.found.title,
          status: result.found.status,
          currentStepKey: result.found.currentStepKey,
          submittedByUserId: result.found.submittedByUserId,
          submittedAt: result.found.submittedAt,
        },
        // PRD.md §13.2 requires requester name, department and line manager
        // on the decision screen.
        requester: result.requesterUser
          ? {
              userId: result.requesterUser.userId,
              displayName: result.requesterUser.displayName,
              email: result.requesterUser.email,
              department: result.requesterMember?.department ?? null,
              lineManagerUserId: result.requesterMember?.lineManagerUserId ?? null,
            }
          : null,
        values,
        // What the approver is being asked to do, read from the version the
        // case is pinned to rather than the definition's current one.
        step: result.step
          ? {
              key: result.step.key,
              name: result.step.name,
              type: result.step.type,
              instructions: result.step.instructions ?? null,
              allowedDecisions: result.step.allowedDecisions,
              requireCommentOn: result.step.requireCommentOn ?? [],
              outputFields: result.step.outputFields ?? [],
            }
          : null,
        canAct: result.actionability.allowed,
      });
    } catch (err) {
      next(err);
    }
  });

  // PRD.md §11.6: claim from a pool. The version-checked UPDATE is what
  // makes "first to claim owns it" (§7) true under concurrency rather than
  // merely likely.
  router.post('/tasks/:taskId/claim', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const taskId = req.params.taskId!;
      const body = parseBody(claimSchema, req.body) ?? {};

      const claimed = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        const task = await requireTask(trx, taskId);

        if (task.assigneeUserId) {
          throw new HttpProblemError(
            409,
            'Conflict',
            task.assigneeUserId === session.userId
              ? 'You already hold this task.'
              : 'Another member has already claimed this task.',
          );
        }

        if (task.status !== 'pending') {
          throw new HttpProblemError(
            409,
            'Conflict',
            `Only a pending task can be claimed; this one is ${task.status}.`,
          );
        }

        const actionability = await canActOnTask(trx, session, task);
        if (!actionability.allowed) {
          throw new HttpProblemError(403, 'Forbidden', actionability.reason);
        }

        return claimCaseTask(trx, task.taskId, body.rowVersion ?? task.rowVersion, session.userId);
      });

      // Claiming changes who owns the work, so it is auditable and worth
      // announcing, but it is not a workflow transition: the case is on the
      // same step before and after.
      await publishOrLog(
        deps,
        [
          {
            eventId: `${claimed.taskId}:task.claimed:${claimed.claimedAt ?? ''}`,
            eventType: 'task.claimed',
            organisationId: session.organisationId,
            occurredAt: claimed.claimedAt ?? new Date().toISOString(),
            actorUserId: session.userId,
            actorType: 'user',
            correlationId: req.correlationId,
            payload: { taskId: claimed.taskId, caseId: claimed.caseId, claimedBy: session.userId },
            schemaVersion: 1,
          },
        ],
        claimed.caseId,
      );

      res.status(200).json({ task: claimed });
    } catch (err) {
      next(mapConcurrency(err));
    }
  });

  // PRD.md §11.6 and §6.3: the decision that advances the case. Records the
  // decision, runs the engine against the pinned version, and persists the
  // case, the next task, the transition and the audit row in one
  // transaction. Events publish after it commits.
  router.post('/tasks/:taskId/decide', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const taskId = req.params.taskId!;
      const body = parseBody(decideSchema, req.body);
      const now = new Date();

      const result = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        const task = await requireTask(trx, taskId);

        if (task.status !== 'pending' && task.status !== 'claimed') {
          throw new HttpProblemError(
            409,
            'Conflict',
            `This task is ${task.status} and can no longer be acted on.`,
          );
        }

        const actionability = await canActOnTask(trx, session, task);
        if (!actionability.allowed) {
          throw new HttpProblemError(403, 'Forbidden', actionability.reason);
        }

        const found = await findCaseById(trx, task.caseId);
        if (!found) {
          throw new HttpProblemError(404, 'Not Found', 'No such task.');
        }

        // The engine keys its routing off the case's current step, so a
        // task left over from an earlier step must not be able to drive a
        // transition from wherever the case has since moved to.
        if (found.currentStepKey !== task.stepKey) {
          throw new HttpProblemError(
            409,
            'Conflict',
            'This case has already moved past the step this task belongs to.',
          );
        }

        // PRD.md §8.2: by cases.version_id, never by definition_id.
        const document = await loadPinnedDocument(
          trx,
          deps.mongoClient,
          session.organisationId,
          found.versionId,
        );

        const values = await readCaseValues(deps.mongoClient, session.organisationId, found.caseId);

        // Output fields (an asset tag, say) become part of the case values
        // before the engine runs, so a later step's condition can branch on
        // something an earlier step recorded.
        const nextValues = body.outputValues ? { ...values, ...body.outputValues } : values;

        let valuesDocumentId: string | undefined;
        if (body.outputValues) {
          valuesDocumentId = await upsertCaseValues(deps.mongoClient, {
            organisationId: session.organisationId,
            caseId: found.caseId,
            values: nextValues,
            now: now.toISOString(),
          });
        }

        // The context's submitter is the case's requester, not whoever is
        // deciding: `lineManager` resolves the requester's manager and
        // `submitter` returns work to the requester, so passing the
        // approver here would quietly reroute both.
        const context = await buildEvaluationContext(trx, {
          submitterUserId: found.submittedByUserId,
          correlationId: req.correlationId,
          now,
          existingCase: found,
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
          values: nextValues,
          event: {
            type: 'taskDecided',
            taskId: task.taskId,
            decision: body.decision,
            ...(body.comment ? { comment: body.comment } : {}),
            ...(body.outputValues ? { outputValues: body.outputValues } : {}),
          },
          context,
        });

        // A refusal (a decision the step does not allow, a missing required
        // comment) leaves the case untouched and rolls back, so the task
        // stays actionable and the client can correct the request.
        if (output.caseUpdates.status === undefined) {
          throw new HttpProblemError(
            409,
            'Conflict',
            output.errors[0]?.message ?? 'The workflow engine refused this decision.',
          );
        }

        // Before persistEngineOutput, which cancels every still-open task
        // when the case terminates. Recording the decision first is what
        // keeps this task 'completed' rather than swept up as 'cancelled'.
        const decided = await recordTaskDecision(trx, {
          taskId: task.taskId,
          expectedRowVersion: task.rowVersion,
          decision: DECISION_OUTCOMES[body.decision],
          comment: body.comment ?? null,
          completedByUserId: session.userId,
        });

        const persisted = await persistEngineOutput(trx, {
          organisationId: session.organisationId,
          actorUserId: session.userId,
          correlationId: req.correlationId,
          existingCase: found,
          output,
          ...(valuesDocumentId !== undefined ? { valuesDocumentId } : {}),
          auditAction: `task.${DECISION_OUTCOMES[body.decision]}`,
        });

        return { decided, persisted };
      });

      await publishOrLog(deps, result.persisted.events, result.decided.caseId);

      res.status(200).json({
        task: result.decided,
        case: result.persisted.updatedCase,
        tasks: result.persisted.tasks,
      });
    } catch (err) {
      next(mapConcurrency(err));
    }
  });

  return router;
}

function parseQueueFilter(query: Record<string, unknown>) {
  const status = typeof query.status === 'string' ? query.status : undefined;
  if (status && !TASK_STATUSES.includes(status as TaskStatus)) {
    throw new HttpProblemError(400, 'Bad Request', `Unknown task status '${status}'.`);
  }

  return {
    ...(status ? { status: status as TaskStatus } : {}),
    ...(typeof query.definitionId === 'string' ? { definitionId: query.definitionId } : {}),
    ...(query.overdue === 'true' ? { overdueAt: new Date() } : {}),
  };
}

// Two people acting on the same task at once is a real race, not a server
// fault: the loser gets a 409 telling them to reload, which is the whole
// point of the row_version check in the repository.
function mapConcurrency(err: unknown): unknown {
  if (err instanceof TaskConcurrencyError) {
    return new HttpProblemError(
      409,
      'Conflict',
      'This task was changed by somebody else while you were working on it. Reload and try again.',
    );
  }
  return err;
}

async function publishOrLog(
  deps: TasksDeps,
  events: Parameters<DomainEventPublisher['publish']>[0],
  caseId: string,
): Promise<void> {
  try {
    await deps.publisher.publish(events);
  } catch (err) {
    deps.logger.error(
      { err, caseId, eventIds: events.map((event) => event.eventId) },
      'domain events were not published after the transaction committed',
    );
  }
}
