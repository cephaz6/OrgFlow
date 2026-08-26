import { advance } from '@orgflow/core';
import {
  allocateCaseReference,
  createCase,
  findCaseById,
  findCasesForCurrentTenant,
  findCaseTasksForCase,
  findProcessDefinitionById,
  findProcessVersionById,
  recordTaskDecision,
  updateCaseState,
  withTenantTransaction,
} from '@orgflow/db';
import type { Database } from '@orgflow/db';
import {
  findProcessDefinitionDocumentById,
  readCaseValues,
  upsertCaseValues,
  verifyDocumentIntegrity,
} from '@orgflow/documents';
import type { DomainEventPublisher } from '@orgflow/events';
import type { Case, CaseStatus, ProcessDefinitionDocument } from '@orgflow/types';
import { Router } from 'express';
import type { Kysely, Transaction } from 'kysely';
import type { MongoClient } from 'mongodb';
import { z } from 'zod';

import { buildEvaluationContext } from '../cases/evaluation-context.js';
import { canViewCase, isAdministrator } from '../cases/permissions.js';
import { persistEngineOutput } from '../cases/persist-engine-output.js';
import { buildCaseTimeline } from '../cases/timeline.js';
import type { Logger } from '../logger.js';
import { HttpProblemError } from '../middleware/error-handler.js';
import { requireSession, sessionOf, type RequestSession } from '../middleware/require-session.js';

export interface CasesDeps {
  db: Kysely<Database>;
  mongoClient: MongoClient;
  publisher: DomainEventPublisher;
  sessionSecret: string;
  logger: Logger;
}

const CASE_STATUSES: CaseStatus[] = [
  'draft',
  'active',
  'completed',
  'rejected',
  'cancelled',
  'unassigned',
];

const createCaseSchema = z.object({
  definitionId: z.string().uuid(),
  values: z.record(z.unknown()).optional(),
});

const patchCaseSchema = z
  .object({
    values: z.record(z.unknown()).optional(),
    title: z.string().min(1).max(500).optional(),
  })
  .refine((body) => body.values !== undefined || body.title !== undefined, {
    message: 'Provide at least one of values or title.',
  });

const resubmitCaseSchema = z
  .object({
    // Optional: the requester may amend before resubmitting, or resubmit
    // unchanged after a conversation happened elsewhere. Supplied values are
    // merged over the existing ones rather than replacing the document, so a
    // partial amendment cannot silently blank untouched fields.
    values: z.record(z.unknown()).optional(),
  })
  .optional();

const cancelCaseSchema = z.object({
  // PRD.md §11.5 calls this "cancel with reason", and §8.5 depends on the
  // reason being recorded, so it is required rather than optional.
  reason: z.string().min(1).max(2000),
});

// PRD.md §4.1 reserves this step key; the engine routes a `return` decision
// to it and creates an amendment task against it.
const RETURNED_STEP_KEY = '$returnedToRequester';

// Turns a Zod failure into the RFC 7807 shape PRD.md §11.10 specifies,
// including the errors[] array with a field path per problem.
function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
      .join('; ');
    throw new HttpProblemError(400, 'Bad Request', detail);
  }
  return parsed.data;
}

function toCaseResponse(found: Case) {
  return {
    caseId: found.caseId,
    definitionId: found.definitionId,
    versionId: found.versionId,
    reference: found.reference,
    title: found.title,
    status: found.status,
    outcome: found.outcome,
    currentStepKey: found.currentStepKey,
    submittedByUserId: found.submittedByUserId,
    submittedAt: found.submittedAt,
    completedAt: found.completedAt,
    dueAt: found.dueAt,
    rowVersion: found.rowVersion,
    createdAt: found.createdAt,
    updatedAt: found.updatedAt,
  };
}

// Loads the definition document a case is pinned to. PRD.md §8.2: the
// engine loads by version_id, never by definition_id, and this is the only
// path a case execution takes to reach its document.
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

// A case that exists for this tenant. Cross-tenant rows never arrive here:
// RLS hides them, so findCaseById returns null and this raises a 404, which
// is what PRD.md §11.10 requires instead of a 403.
async function requireCase(trx: Transaction<Database>, caseId: string): Promise<Case> {
  const found = await findCaseById(trx, caseId);
  if (!found) {
    throw new HttpProblemError(404, 'Not Found', 'No such case.');
  }
  return found;
}

// A case this user is permitted to read, per PRD.md §12.3's visibility
// rule. Being in the right organisation is necessary but not sufficient:
// an ordinary member cannot read a colleague's expense claim just because
// they share a workspace. The refusal is a 404 rather than a 403 for the
// same reason cross-tenant reads are, since a 403 confirms the case exists.
async function requireVisibleCase(
  trx: Transaction<Database>,
  session: RequestSession,
  caseId: string,
): Promise<Case> {
  const found = await requireCase(trx, caseId);
  if (!(await canViewCase(trx, session, found))) {
    throw new HttpProblemError(404, 'Not Found', 'No such case.');
  }
  return found;
}

// Closes the amendment task a return created, recording it as completed by
// the requester rather than cancelled: they did the work the task asked for.
// Written on the caller's transaction so it lands with the resubmission or
// not at all.
async function completeReturnedTask(
  trx: Transaction<Database>,
  caseId: string,
  requesterUserId: string,
): Promise<void> {
  const tasks = await findCaseTasksForCase(trx, caseId);
  const returned = tasks.find(
    (task) =>
      task.stepKey === RETURNED_STEP_KEY &&
      (task.status === 'pending' || task.status === 'claimed'),
  );

  if (returned) {
    await recordTaskDecision(trx, {
      taskId: returned.taskId,
      expectedRowVersion: returned.rowVersion,
      decision: 'completed',
      completedByUserId: requesterUserId,
    });
  }
}

function titleFromValues(
  document: ProcessDefinitionDocument,
  values: Record<string, unknown>,
  fallback: string,
): string {
  const key = document.form.titleFieldKey;
  const value = key ? values[key] : undefined;
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().slice(0, 500)
    : fallback;
}

export function createCasesRouter(deps: CasesDeps): Router {
  const router = Router();

  router.use('/cases', requireSession(deps.sessionSecret));

  // PRD.md §11.5: create a draft against a definition. No reference is
  // allocated and no version is pinned yet; both happen at submit
  // (ADR-0013, PRD.md §8.2).
  router.post('/cases', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const body = parseBody(createCaseSchema, req.body);

      const created = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        const definition = await findProcessDefinitionById(trx, body.definitionId);
        if (!definition?.currentVersionId) {
          throw new HttpProblemError(404, 'Not Found', 'No such published process definition.');
        }

        // cases.version_id is NOT NULL, so a draft has to reference
        // something. It holds the version current at draft creation as a
        // provisional value, which submit overwrites with whatever is
        // current at that moment: PRD.md §8.2 pins at submission, not at
        // draft creation, because a version published in between must be
        // the one the case actually executes.
        const draft = await createCase(trx, {
          organisationId: session.organisationId,
          definitionId: definition.definitionId,
          versionId: definition.currentVersionId,
          title: definition.name,
          submittedByUserId: session.userId,
        });

        if (body.values) {
          const valuesDocumentId = await upsertCaseValues(deps.mongoClient, {
            organisationId: session.organisationId,
            caseId: draft.caseId,
            values: body.values,
            now: new Date().toISOString(),
          });

          return updateCaseState(trx, {
            caseId: draft.caseId,
            expectedRowVersion: draft.rowVersion,
            valuesDocumentId,
          });
        }

        return draft;
      });

      res.status(201).json({ case: toCaseResponse(created) });
    } catch (err) {
      next(err);
    }
  });

  // PRD.md §11.5: list, filterable by status, definitionId, submittedBy and
  // view. Cursor pagination per §11.10.
  router.get('/cases', async (req, res, next) => {
    try {
      const session = sessionOf(req);

      const statusParam = typeof req.query.status === 'string' ? req.query.status : undefined;
      if (statusParam && !CASE_STATUSES.includes(statusParam as CaseStatus)) {
        throw new HttpProblemError(400, 'Bad Request', `Unknown status '${statusParam}'.`);
      }

      const view = req.query.view === 'mine' ? 'mine' : 'all';
      const submittedBy =
        view === 'mine'
          ? session.userId
          : typeof req.query.submittedBy === 'string'
            ? req.query.submittedBy
            : undefined;

      const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
        throw new HttpProblemError(400, 'Bad Request', 'limit must be a positive integer.');
      }

      const page = await withTenantTransaction(deps.db, session.organisationId, (trx) =>
        findCasesForCurrentTenant(trx, {
          ...(submittedBy ? { submittedByUserId: submittedBy } : {}),
          ...(statusParam ? { status: statusParam as CaseStatus } : {}),
          ...(typeof req.query.definitionId === 'string'
            ? { definitionId: req.query.definitionId }
            : {}),
          ...(typeof req.query.query === 'string' ? { query: req.query.query } : {}),
          ...(limit !== undefined ? { limit } : {}),
          ...(typeof req.query.cursor === 'string' ? { cursor: req.query.cursor } : {}),
        }),
      );

      res.status(200).json({
        data: page.cases.map(toCaseResponse),
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      });
    } catch (err) {
      next(err);
    }
  });

  // PRD.md §11.5: the full case. Attachments are Phase 7 and absent.
  router.get('/cases/:caseId', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const caseId = req.params.caseId!;

      const result = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        const found = await requireVisibleCase(trx, session, caseId);
        const [tasks, timeline, document] = await Promise.all([
          findCaseTasksForCase(trx, found.caseId),
          buildCaseTimeline(trx, found.caseId),
          // Loaded by version_id, which is the whole point: a case detail
          // that labelled its values from the definition's *current*
          // version would describe the case using questions that were not
          // asked, the moment a new version is published. PRD.md §8.2 pins
          // at submission and §8.4 keeps that pin through a resubmission,
          // and a read path is no more entitled to ignore it than the
          // engine is.
          loadPinnedDocument(trx, deps.mongoClient, session.organisationId, found.versionId),
        ]);
        return { found, tasks, timeline, document };
      });

      const values = await readCaseValues(deps.mongoClient, session.organisationId, caseId);

      res.status(200).json({
        case: toCaseResponse(result.found),
        values,
        tasks: result.tasks,
        timeline: result.timeline,
        // The pinned document, so a caller can render the answers against
        // the questions this case was actually asked.
        document: result.document,
      });
    } catch (err) {
      next(err);
    }
  });

  // PRD.md §11.5: update draft values. Drafts only; once submitted, a case
  // changes through decisions, not edits.
  router.patch('/cases/:caseId', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const caseId = req.params.caseId!;
      const body = parseBody(patchCaseSchema, req.body);

      const updated = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        const found = await requireVisibleCase(trx, session, caseId);

        if (found.status !== 'draft') {
          throw new HttpProblemError(
            409,
            'Conflict',
            `Only a draft can be edited; this case is ${found.status}.`,
          );
        }

        // Within the tenant, so 403 rather than 404: the case's existence
        // is not a cross-tenant disclosure, and the requester needs to
        // know the refusal is about permission, not a bad id.
        if (found.submittedByUserId !== session.userId) {
          throw new HttpProblemError(403, 'Forbidden', 'Only the requester can edit this draft.');
        }

        const valuesDocumentId = body.values
          ? await upsertCaseValues(deps.mongoClient, {
              organisationId: session.organisationId,
              caseId: found.caseId,
              values: body.values,
              now: new Date().toISOString(),
            })
          : undefined;

        return updateCaseState(trx, {
          caseId: found.caseId,
          expectedRowVersion: found.rowVersion,
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(valuesDocumentId !== undefined ? { valuesDocumentId } : {}),
        });
      });

      res.status(200).json({ case: toCaseResponse(updated) });
    } catch (err) {
      next(err);
    }
  });

  // PRD.md §11.5 and §6: the important one. Pins the version, allocates the
  // reference, runs the engine, and persists case, tasks, transitions and
  // audit in one transaction. Events publish only after that commits.
  router.post('/cases/:caseId/submit', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const caseId = req.params.caseId!;
      const now = new Date();

      const result = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        const found = await requireVisibleCase(trx, session, caseId);

        if (found.status !== 'draft') {
          throw new HttpProblemError(
            409,
            'Conflict',
            `Only a draft can be submitted; this case is ${found.status}.`,
          );
        }

        if (found.submittedByUserId !== session.userId) {
          throw new HttpProblemError(403, 'Forbidden', 'Only the requester can submit this draft.');
        }

        const definition = await findProcessDefinitionById(trx, found.definitionId);
        if (!definition?.currentVersionId) {
          throw new HttpProblemError(
            409,
            'Conflict',
            'This process has no published version to submit against.',
          );
        }

        // PRD.md §8.2: the pin is taken here, at submission, from whatever
        // is current now, and never changes afterwards.
        const versionId = definition.currentVersionId;
        const document = await loadPinnedDocument(
          trx,
          deps.mongoClient,
          session.organisationId,
          versionId,
        );

        const values = await readCaseValues(deps.mongoClient, session.organisationId, found.caseId);

        const context = await buildEvaluationContext(trx, {
          submitterUserId: session.userId,
          correlationId: req.correlationId,
          now,
          existingCase: found,
        });

        // Allocated last among the reads, so the row lock it takes on
        // process_definitions (ADR-0013) is held for as little of the
        // transaction as possible.
        const reference = await allocateCaseReference(trx, found.definitionId);

        const output = advance({
          definition: document,
          caseState: {
            caseId: found.caseId,
            definitionId: found.definitionId,
            versionId,
            status: 'draft',
            outcome: null,
            currentStepKey: null,
          },
          values,
          event: { type: 'caseSubmitted' },
          context,
        });

        // The engine refuses an event it cannot act on by returning errors
        // and no case update. That is a client problem, so it becomes a
        // 409 and the transaction rolls back, which also returns the
        // reference counter to where it was.
        if (output.caseUpdates.status === undefined) {
          throw new HttpProblemError(
            409,
            'Conflict',
            output.errors[0]?.message ?? 'The workflow engine refused this submission.',
          );
        }

        return persistEngineOutput(trx, {
          organisationId: session.organisationId,
          actorUserId: session.userId,
          correlationId: req.correlationId,
          existingCase: found,
          output,
          reference,
          versionId,
          title: titleFromValues(document, values, definition.name),
          submittedAt: now,
          auditAction: 'case.submitted',
        });
      });

      // TECH-STACK.md §6: publish after the transaction commits, never
      // inside it. A crash between the two loses the event; consumers are
      // idempotent on eventId, and closing the gap properly needs the
      // transactional outbox that is not built yet.
      await publishOrLog(deps, result.events, caseId);

      res.status(200).json({
        case: toCaseResponse(result.updatedCase),
        tasks: result.tasks,
      });
    } catch (err) {
      next(err);
    }
  });

  // PRD.md §11.5: resubmit a returned case.
  //
  // The one thing this must not do is re-pin the version. Submit takes
  // whatever is current; resubmit deliberately keeps the version the case
  // already holds, because PRD.md §8.4 says a returned case never silently
  // upgrades: the requester is amending against the form they saw. It does
  // not allocate a reference either, since the case already has one.
  router.post('/cases/:caseId/resubmit', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const caseId = req.params.caseId!;
      const body = parseBody(resubmitCaseSchema, req.body) ?? {};
      const now = new Date();

      const result = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        const found = await requireVisibleCase(trx, session, caseId);

        if (found.submittedByUserId !== session.userId) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Only the requester can resubmit this case.',
          );
        }

        // The engine enforces the same rule and would report it as an
        // error, but checking here turns it into a clearer message than
        // the generic engine-refusal path produces.
        if (found.status !== 'active' || found.currentStepKey !== null) {
          throw new HttpProblemError(
            409,
            'Conflict',
            'Only a case that was returned to its requester can be resubmitted.',
          );
        }

        const document = await loadPinnedDocument(
          trx,
          deps.mongoClient,
          session.organisationId,
          // PRD.md §8.4 and §8.2: the case's existing pin, not the
          // definition's current version.
          found.versionId,
        );

        const existingValues = await readCaseValues(
          deps.mongoClient,
          session.organisationId,
          found.caseId,
        );
        const values = body.values ? { ...existingValues, ...body.values } : existingValues;

        let valuesDocumentId: string | undefined;
        if (body.values) {
          valuesDocumentId = await upsertCaseValues(deps.mongoClient, {
            organisationId: session.organisationId,
            caseId: found.caseId,
            values,
            now: now.toISOString(),
          });
        }

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
          values,
          event: { type: 'caseResubmitted' },
          context,
        });

        if (output.caseUpdates.status === undefined) {
          throw new HttpProblemError(
            409,
            'Conflict',
            output.errors[0]?.message ?? 'The workflow engine refused this resubmission.',
          );
        }

        // The engine's caseResubmitted branch runs from startStepKey and
        // does not close the amendment task, and persistEngineOutput only
        // cancels open tasks when a case terminates. Without this the case
        // would move back to its first step while the returned task sat
        // pending forever, showing in the requester's queue as outstanding
        // work they had already done.
        await completeReturnedTask(trx, found.caseId, session.userId);

        return persistEngineOutput(trx, {
          organisationId: session.organisationId,
          actorUserId: session.userId,
          correlationId: req.correlationId,
          existingCase: found,
          output,
          title: titleFromValues(document, values, found.title),
          ...(valuesDocumentId !== undefined ? { valuesDocumentId } : {}),
          auditAction: 'case.resubmitted',
        });
      });

      await publishOrLog(deps, result.events, caseId);

      res.status(200).json({
        case: toCaseResponse(result.updatedCase),
        tasks: result.tasks,
      });
    } catch (err) {
      next(err);
    }
  });

  // PRD.md §11.5: cancel with a reason. PRD.md §6.2 names the requester or
  // an admin as the actors, and §8.5 relies on this being available to an
  // admin specifically, as the remedy when a published version turns out to
  // contain a critical error.
  router.post('/cases/:caseId/cancel', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const caseId = req.params.caseId!;
      const body = parseBody(cancelCaseSchema, req.body);
      const now = new Date();

      const result = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        const found = await requireVisibleCase(trx, session, caseId);

        if (found.submittedByUserId !== session.userId && !(await isAdministrator(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Only the requester or an administrator can cancel this case.',
          );
        }

        if (['completed', 'rejected', 'cancelled'].includes(found.status)) {
          throw new HttpProblemError(
            409,
            'Conflict',
            `This case is already ${found.status} and cannot be cancelled.`,
          );
        }

        const document = await loadPinnedDocument(
          trx,
          deps.mongoClient,
          session.organisationId,
          found.versionId,
        );

        const values = await readCaseValues(deps.mongoClient, session.organisationId, found.caseId);

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
          values,
          event: { type: 'caseCancelled', reason: body.reason },
          context,
        });

        if (output.caseUpdates.status === undefined) {
          throw new HttpProblemError(
            409,
            'Conflict',
            output.errors[0]?.message ?? 'The workflow engine refused this cancellation.',
          );
        }

        // persistEngineOutput cancels every open task itself once the case
        // reaches a terminal step, so nothing extra is needed here.
        return persistEngineOutput(trx, {
          organisationId: session.organisationId,
          actorUserId: session.userId,
          correlationId: req.correlationId,
          existingCase: found,
          output,
          reason: body.reason,
          auditAction: 'case.cancelled',
        });
      });

      await publishOrLog(deps, result.events, caseId);

      res.status(200).json({ case: toCaseResponse(result.updatedCase) });
    } catch (err) {
      next(err);
    }
  });

  // PRD.md §11.5: transitions, decisions and audit, merged.
  router.get('/cases/:caseId/timeline', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const caseId = req.params.caseId!;

      const timeline = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        await requireVisibleCase(trx, session, caseId);
        return buildCaseTimeline(trx, caseId);
      });

      res.status(200).json({ data: timeline });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

// A publish failure after a successful commit must not turn a completed
// submission into a 500: the case is submitted, the tasks exist, and the
// audit row is written. It is logged loudly instead, because a silently
// dropped event is a notification a person never receives.
async function publishOrLog(
  deps: CasesDeps,
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
