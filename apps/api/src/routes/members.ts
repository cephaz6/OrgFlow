import {
  countActiveOwnersForCurrentTenant,
  findMemberDirectoryEntryByUserId,
  findMemberDirectoryForCurrentTenant,
  findOrganisationMemberByUserId,
  updateOrganisationMember,
  withTenantTransaction,
} from '@orgflow/db';
import type { Database } from '@orgflow/db';
import type { OrganisationMemberSummary, OrganisationRole } from '@orgflow/types';
import { Router } from 'express';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import { isAdministrator } from '../cases/permissions.js';
import { parseBody } from '../lib/parse-body.js';
import { HttpProblemError } from '../middleware/error-handler.js';
import { requireSession, sessionOf } from '../middleware/require-session.js';

export interface MembersDeps {
  db: Kysely<Database>;
  sessionSecret: string;
}

const ROLES = ['member', 'approver', 'processOwner', 'admin', 'owner'] as const;

const listQuerySchema = z.object({
  query: z.string().min(1).optional(),
  status: z.enum(['active', 'suspended', 'removed']).optional(),
  role: z.enum(ROLES).optional(),
  // PRD.md §11.10: cursor-based pagination, ?limit&cursor.
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().min(1).optional(),
});

// Every field optional, but at least one present: a PATCH carrying nothing
// is a caller mistake worth surfacing rather than a silent no-op that still
// bumps updated_at.
const patchSchema = z
  .object({
    roles: z.array(z.enum(ROLES)).min(1).optional(),
    jobTitle: z.string().max(200).nullable().optional(),
    department: z.string().max(200).nullable().optional(),
    lineManagerUserId: z.string().uuid().nullable().optional(),
    status: z.enum(['active', 'suspended']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

function toBody(member: OrganisationMemberSummary) {
  return {
    userId: member.userId,
    email: member.email,
    displayName: member.displayName,
    roles: member.roles,
    jobTitle: member.jobTitle,
    department: member.department,
    lineManagerUserId: member.lineManagerUserId,
    lineManagerName: member.lineManagerName,
    status: member.status,
    joinedAt: member.joinedAt,
  };
}

// PRD.md §11.2's member endpoints, gated to admin and owner because §12.2
// gives "manage members" to admin and above and to nobody below it.
//
// Two invariants the specification does not state but an implementation
// cannot do without, both enforced here rather than in the client:
//
// An organisation must keep at least one active owner. Nothing else can
// restore the role once the last holder loses it, so removing or demoting
// the last owner locks every remaining member out of organisation settings
// permanently, with no in-product recovery.
//
// An administrator may not change their own roles. Not because self-service
// demotion is wrong in principle, but because it is indistinguishable from
// the mistake of demoting yourself out of the screen you are standing in,
// and the recovery needs somebody else with the role.
export function createMembersRouter(deps: MembersDeps): Router {
  const router = Router();

  router.use('/members', requireSession(deps.sessionSecret));

  router.get('/members', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const filter = parseBody(listQuerySchema, req.query as Record<string, unknown>);

      const page = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await isAdministrator(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Managing members requires the admin or owner role.',
          );
        }

        return findMemberDirectoryForCurrentTenant(trx, filter);
      });

      res.status(200).json({
        members: page.members.map(toBody),
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/members/:userId', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const targetUserId = req.params.userId!;
      const patch = parseBody(patchSchema, req.body);

      const updated = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await isAdministrator(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Managing members requires the admin or owner role.',
          );
        }

        if (targetUserId === session.userId && patch.roles) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'You cannot change your own roles. Ask another admin or owner to do it.',
          );
        }

        // Read before write, inside the same transaction as the update, so
        // the owner count and the target's current roles cannot shift
        // underneath the guard below.
        const existing = await findOrganisationMemberByUserId(trx, targetUserId);
        if (!existing) {
          // Cross-tenant reads as absent under RLS, so this is the same 404
          // a genuinely unknown user gets (PRD.md §11.10, ADR-0015).
          throw new HttpProblemError(404, 'Not Found', 'No such member.');
        }

        await assertOwnershipSurvives(trx, existing.roles, existing.status, patch);

        const member = await updateOrganisationMember(trx, targetUserId, patch);
        if (!member) {
          throw new HttpProblemError(404, 'Not Found', 'No such member.');
        }

        // Re-read through the directory projection so the response carries
        // the joined identity, including a line manager name that may have
        // just changed. The row exists by construction: the update above
        // returned it inside this same transaction.
        const summary = await findMemberDirectoryEntryByUserId(trx, targetUserId);
        if (!summary) {
          throw new HttpProblemError(404, 'Not Found', 'No such member.');
        }
        return summary;
      });

      res.status(200).json(toBody(updated));
    } catch (err) {
      next(err);
    }
  });

  // Removal is a status change, not a delete. Cases, tasks and audit rows
  // reference the user permanently, and PRD.md §2's own status check
  // constraint already carries 'removed', so the row has to survive for the
  // history to stay readable. A hard delete would either break those
  // references or cascade away the evidence.
  router.delete('/members/:userId', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const targetUserId = req.params.userId!;

      await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await isAdministrator(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Managing members requires the admin or owner role.',
          );
        }

        if (targetUserId === session.userId) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'You cannot remove yourself. Ask another admin or owner to do it.',
          );
        }

        const existing = await findOrganisationMemberByUserId(trx, targetUserId);
        if (!existing) {
          throw new HttpProblemError(404, 'Not Found', 'No such member.');
        }

        await assertOwnershipSurvives(trx, existing.roles, existing.status, {
          status: 'removed',
        });

        const member = await updateOrganisationMember(trx, targetUserId, { status: 'removed' });
        if (!member) {
          throw new HttpProblemError(404, 'Not Found', 'No such member.');
        }
      });

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}

// Refuses a change that would leave the organisation with no active owner.
// Takes the target's current roles and status rather than re-reading them,
// so the caller's transaction is the only reader and the count cannot move
// between the check and the write.
async function assertOwnershipSurvives(
  trx: Parameters<typeof countActiveOwnersForCurrentTenant>[0],
  currentRoles: OrganisationRole[],
  currentStatus: string,
  patch: { roles?: OrganisationRole[] | undefined; status?: string | undefined },
): Promise<void> {
  const isActiveOwner = currentStatus === 'active' && currentRoles.includes('owner');
  if (!isActiveOwner) {
    return;
  }

  const losesOwnerRole = patch.roles !== undefined && !patch.roles.includes('owner');
  const losesActiveStatus = patch.status !== undefined && patch.status !== 'active';
  if (!losesOwnerRole && !losesActiveStatus) {
    return;
  }

  if ((await countActiveOwnersForCurrentTenant(trx)) <= 1) {
    throw new HttpProblemError(
      409,
      'Conflict',
      'This is the only owner. Give the owner role to somebody else first, otherwise nobody could manage the organisation.',
    );
  }
}
