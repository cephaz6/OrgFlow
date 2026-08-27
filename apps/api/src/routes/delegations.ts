import {
  createDelegation,
  deleteDelegation,
  findDelegationById,
  findDelegationsForOrganisation,
  findDelegationsForUser,
  findOrganisationMemberByUserId,
  findUserByEmail,
  withTenantTransaction,
} from '@orgflow/db';
import type { Database } from '@orgflow/db';
import { findUserById } from '@orgflow/db';
import type { Delegation } from '@orgflow/types';
import { Router } from 'express';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import { isAdministrator } from '../cases/permissions.js';
import { HttpProblemError } from '../middleware/error-handler.js';
import { requireSession, sessionOf } from '../middleware/require-session.js';

export interface DelegationsDeps {
  db: Kysely<Database>;
  sessionSecret: string;
}

const createDelegationSchema = z
  .object({
    toUserEmail: z.string().email(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    reason: z.string().max(2000).optional(),
  })
  .refine((body) => new Date(body.endsAt) > new Date(body.startsAt), {
    message: 'endsAt must be after startsAt.',
  });

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

// The delegations list shows who is on the other side of each row, so the
// route resolves both users' display names here rather than sending raw ids
// for the browser to look up one at a time.
async function toResponse(deps: DelegationsDeps, sessionUserId: string, delegation: Delegation) {
  const counterpartUserId =
    delegation.fromUserId === sessionUserId ? delegation.toUserId : delegation.fromUserId;
  const counterpart = await findUserById(deps.db, counterpartUserId);

  return {
    delegationId: delegation.delegationId,
    fromUserId: delegation.fromUserId,
    toUserId: delegation.toUserId,
    direction:
      delegation.fromUserId === sessionUserId ? ('outgoing' as const) : ('incoming' as const),
    counterpartName: counterpart?.displayName ?? 'A former member',
    startsAt: delegation.startsAt,
    endsAt: delegation.endsAt,
    reason: delegation.reason,
    createdAt: delegation.createdAt,
  };
}

// The org-wide listing's own shape, not toResponse's: an administrator
// browsing every delegation in the tenant is not a party to most of them,
// so "direction" and "counterpart" (both relative to the viewer) do not
// mean anything here. Both sides are named explicitly instead.
async function toOrgResponse(deps: DelegationsDeps, delegation: Delegation) {
  const [from, to] = await Promise.all([
    findUserById(deps.db, delegation.fromUserId),
    findUserById(deps.db, delegation.toUserId),
  ]);

  return {
    delegationId: delegation.delegationId,
    fromUserId: delegation.fromUserId,
    fromUserName: from?.displayName ?? 'A former member',
    toUserId: delegation.toUserId,
    toUserName: to?.displayName ?? 'A former member',
    startsAt: delegation.startsAt,
    endsAt: delegation.endsAt,
    reason: delegation.reason,
    createdAt: delegation.createdAt,
  };
}

// PRD.md §7's delegation: out-of-office cover, created by the person
// delegating their own work (or an admin on their behalf). There is no
// dedicated org-wide management surface here (that belongs to the Admin
// work item), only what a person needs to redirect their own tasks and see
// what they have redirected or been handed.
export function createDelegationsRouter(deps: DelegationsDeps): Router {
  const router = Router();

  router.use('/delegations', requireSession(deps.sessionSecret));

  router.post('/delegations', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const body = parseBody(createDelegationSchema, req.body);

      const target = await findUserByEmail(deps.db, body.toUserEmail);
      if (!target) {
        throw new HttpProblemError(
          400,
          'Bad Request',
          'No user was found with that email address.',
        );
      }
      if (target.userId === session.userId) {
        throw new HttpProblemError(400, 'Bad Request', 'You cannot delegate to yourself.');
      }

      const created = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        // Delegating to someone outside the organisation would create a
        // task nobody in this tenant can act on; PRD.md §7's "must be an
        // active member" rule for specificUser assignment applies here for
        // the same reason.
        const member = await findOrganisationMemberByUserId(trx, target.userId);
        if (!member) {
          throw new HttpProblemError(
            400,
            'Bad Request',
            'The delegate must be a member of this organisation.',
          );
        }

        return createDelegation(trx, {
          organisationId: session.organisationId,
          fromUserId: session.userId,
          toUserId: target.userId,
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          ...(body.reason !== undefined ? { reason: body.reason } : {}),
        });
      });

      res.status(201).json({ delegation: await toResponse(deps, session.userId, created) });
    } catch (err) {
      next(err);
    }
  });

  // ?mine=false (admin only) lists every delegation in the organisation;
  // the default is the caller's own, on either side of it.
  router.get('/delegations', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const mine = req.query.mine !== 'false';

      if (
        !mine &&
        !(await withTenantTransaction(deps.db, session.organisationId, (trx) =>
          isAdministrator(trx, session),
        ))
      ) {
        throw new HttpProblemError(
          403,
          'Forbidden',
          'Only an administrator can list every delegation.',
        );
      }

      const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
        throw new HttpProblemError(400, 'Bad Request', 'limit must be a positive integer.');
      }

      const filter = {
        ...(typeof req.query.query === 'string' ? { query: req.query.query } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(typeof req.query.cursor === 'string' ? { cursor: req.query.cursor } : {}),
      };

      // Two genuinely different queries, not one query with an admin
      // escape hatch: findDelegationsForUser is scoped to session.userId
      // on either side, which is exactly wrong for "every delegation in
      // the organisation" (mine=false's own stated purpose above).
      let page;
      let data;
      if (mine) {
        page = await withTenantTransaction(deps.db, session.organisationId, (trx) =>
          findDelegationsForUser(trx, session.userId, filter),
        );
        data = await Promise.all(
          page.delegations.map((delegation) => toResponse(deps, session.userId, delegation)),
        );
      } else {
        page = await withTenantTransaction(deps.db, session.organisationId, (trx) =>
          findDelegationsForOrganisation(trx, filter),
        );
        data = await Promise.all(
          page.delegations.map((delegation) => toOrgResponse(deps, delegation)),
        );
      }

      res.status(200).json({ data, nextCursor: page.nextCursor, hasMore: page.hasMore });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/delegations/:delegationId', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const delegationId = req.params.delegationId!;

      await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        const found = await findDelegationById(trx, delegationId);
        // Cross-tenant reads arrive here as null (RLS hid the row); a
        // delegation that belongs to someone else in the same organisation
        // is a permission question, not an existence one, so that case
        // gets 403, not 404 (matching PATCH /cases/:id's own draft-owner
        // check).
        if (!found) {
          throw new HttpProblemError(404, 'Not Found', 'No such delegation.');
        }
        if (found.fromUserId !== session.userId && !(await isAdministrator(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Only the person who created this delegation, or an administrator, can cancel it.',
          );
        }

        await deleteDelegation(trx, delegationId);
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
