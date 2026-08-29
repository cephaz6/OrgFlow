import {
  createCaseComment,
  findCaseById,
  findCommentsForCase,
  findUserById,
  findUsersByIds,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import type { Case, CommentVisibility } from '@orgflow/types';
import { Router } from 'express';
import type { Kysely, Transaction } from 'kysely';
import { z } from 'zod';

import { canSeeInternalComments, canViewCase } from '../cases/permissions.js';
import { HttpProblemError } from '../middleware/error-handler.js';
import { parseBody } from '../lib/parse-body.js';
import { requireSession, sessionOf, type RequestSession } from '../middleware/require-session.js';

export interface CaseCommentsDeps {
  db: Kysely<Database>;
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
