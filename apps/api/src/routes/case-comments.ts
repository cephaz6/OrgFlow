import { randomUUID } from 'node:crypto';

import {
  createCaseComment,
  findCaseById,
  findCommentsForCase,
  findUserById,
  findUsersByIds,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import type { DomainEventPublisher } from '@orgflow/events';
import type { Case, CommentVisibility, DomainEvent } from '@orgflow/types';
import { Router } from 'express';
import type { Kysely, Transaction } from 'kysely';
import { z } from 'zod';

import { canSeeInternalComments, canViewCase } from '../cases/permissions.js';
import { HttpProblemError } from '../middleware/error-handler.js';
import { parseBody } from '../lib/parse-body.js';
import { requireSession, sessionOf, type RequestSession } from '../middleware/require-session.js';

export interface CaseCommentsDeps {
  db: Kysely<Database>;
  publisher: DomainEventPublisher;
  sessionSecret: string;
}

const createSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  visibility: z.enum(['all', 'approvers']).default('all'),
});

// Same 404-not-403 reasoning as cases.ts's own requireVisibleCase: a case
// this session cannot see reads as absent, not forbidden, since a 403
// would confirm a case with this id exists at all (PRD.md §11.10).
async function requireVisibleCase(
  trx: Transaction<Database>,
  session: RequestSession,
  caseId: string,
): Promise<Case> {
  const found = await findCaseById(trx, caseId);
  if (!found || !(await canViewCase(trx, session, found))) {
    throw new HttpProblemError(404, 'Not Found', 'No such case.');
  }
  return found;
}

// Duplicated from attachments.ts rather than shared: that file already
// carries its own copy of this exact helper for the same reason, a
// one-off event envelope builder is not worth a cross-module dependency.
function buildEvent(input: {
  eventType: DomainEvent['eventType'];
  organisationId: string;
  actorUserId: string;
  correlationId: string;
  payload: Record<string, unknown>;
}): DomainEvent {
  return {
    eventId: randomUUID(),
    eventType: input.eventType,
    organisationId: input.organisationId,
    occurredAt: new Date().toISOString(),
    actorUserId: input.actorUserId,
    actorType: 'user',
    correlationId: input.correlationId,
    payload: input.payload,
    schemaVersion: 1,
  };
}

// Comments are a case sub-resource, not its own top-level route: nothing
// about a comment makes sense without the case it belongs to, the same
// reasoning attachments.ts's own /cases/:caseId/attachments routes follow.
export function createCaseCommentsRouter(deps: CaseCommentsDeps): Router {
  const router = Router();

  router.use('/cases/:caseId/comments', requireSession(deps.sessionSecret));

  router.get('/cases/:caseId/comments', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const caseId = req.params.caseId!;

      const comments = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        const found = await requireVisibleCase(trx, session, caseId);
        const includeApproversOnly = await canSeeInternalComments(trx, session, found);
        return findCommentsForCase(trx, caseId, { includeApproversOnly });
      });

      const authors = await withTenantTransaction(deps.db, session.organisationId, (trx) =>
        findUsersByIds(trx, [...new Set(comments.map((comment) => comment.authorUserId))]),
      );
      const authorNameById = new Map(authors.map((author) => [author.userId, author.displayName]));

      res.status(200).json({
        data: comments.map((comment) => ({
          commentId: comment.commentId,
          caseId: comment.caseId,
          authorUserId: comment.authorUserId,
          authorDisplayName: authorNameById.get(comment.authorUserId) ?? 'Former member',
          body: comment.body,
          visibility: comment.visibility,
          createdAt: comment.createdAt,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/cases/:caseId/comments', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const caseId = req.params.caseId!;
      const input = parseBody(createSchema, req.body);

      const comment = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        const found = await requireVisibleCase(trx, session, caseId);

        // An 'approvers' comment is an internal note; a plain viewer (the
        // requester, seeing the case only because it is theirs) cannot
        // write one, the same audience canSeeInternalComments already
        // reads them by. Nothing stops a requester from posting an 'all'
        // comment, which is exactly the "ask a clarifying question back"
        // case this feature exists for.
        const visibility: CommentVisibility = input.visibility ?? 'all';
        if (visibility === 'approvers' && !(await canSeeInternalComments(trx, session, found))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Only someone handling this case can post an internal note.',
          );
        }

        return createCaseComment(trx, {
          organisationId: session.organisationId,
          caseId,
          authorUserId: session.userId,
          body: input.body,
          visibility,
        });
      });

      const author = await withTenantTransaction(deps.db, session.organisationId, (trx) =>
        findUserById(trx, session.userId),
      );

      // Fire-and-forget, after the transaction has already committed: a
      // publish failure here must not undo a comment that was already
      // saved, and the worker not being told about it is a delivery gap
      // to notice from monitoring, not a reason to fail a request that
      // already succeeded (the same reasoning attachments.ts's own
      // post-commit publish already follows).
      void deps.publisher
        .publish([
          buildEvent({
            eventType: 'case.commented',
            organisationId: session.organisationId,
            actorUserId: session.userId,
            correlationId: req.correlationId,
            payload: { caseId, commentId: comment.commentId },
          }),
        ])
        .catch(() => {
          // See the comment above: already committed, nothing to undo.
        });

      res.status(201).json({
        commentId: comment.commentId,
        caseId: comment.caseId,
        authorUserId: comment.authorUserId,
        authorDisplayName: author?.displayName ?? 'You',
        body: comment.body,
        visibility: comment.visibility,
        createdAt: comment.createdAt,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
