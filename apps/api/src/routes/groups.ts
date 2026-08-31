import {
  createGroup,
  deleteGroup,
  ensureGroupMember,
  findGroupMembersForGroup,
  findGroupsForOrganisation,
  findOrganisationMemberByUserId,
  removeGroupMember,
  updateGroup,
  withTenantTransaction,
  type Database,
  type Group,
} from '@orgflow/db';
import { Router } from 'express';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import { isAdministrator } from '../cases/permissions.js';
import { parseBody } from '../lib/parse-body.js';
import { slugify } from '../lib/slugify.js';
import { HttpProblemError } from '../middleware/error-handler.js';
import { requireSession, sessionOf } from '../middleware/require-session.js';

export interface GroupsDeps {
  db: Kysely<Database>;
  sessionSecret: string;
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
});

const patchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

const addMemberSchema = z.object({
  userId: z.string().uuid(),
});

function toBody(group: Group) {
  return {
    groupId: group.groupId,
    key: group.key,
    name: group.name,
    description: group.description,
  };
}

// Mirrors process-definitions.ts's allocateDefinitionKey: tries the plain
// slug first, then '-2', '-3', ... so two groups named the same thing do
// not require the creator to think of a different one themselves.
// findGroupsForOrganisation, not a dedicated lookup, since the row count
// per tenant is small and this is already exactly the list the management
// screen itself renders.
async function allocateGroupKey(
  trx: Parameters<typeof findGroupsForOrganisation>[0],
  name: string,
): Promise<string> {
  const existing = await findGroupsForOrganisation(trx);
  const takenKeys = new Set(existing.map((group) => group.key));

  const base = slugify(name) || 'group';
  for (let suffix = 1; suffix < 100; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    if (!takenKeys.has(candidate)) {
      return candidate;
    }
  }
  throw new HttpProblemError(409, 'Conflict', 'Could not allocate a unique key for this name.');
}

function isForeignKeyViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === '23503'
  );
}

// PRD.md §12.2 gives "manage members" to admin and above; a group is a
// pool of members, so the same gate applies to creating, renaming,
// deleting one, or changing who is in it. GET /groups stays open to any
// signed-in member, unchanged from before this file grew the routes below
// it: ADR-0027's owning-group select on a process definition needs it, and
// that is a process owner's screen, not only an admin's.
export function createGroupsRouter(deps: GroupsDeps): Router {
  const router = Router();

  router.use('/groups', requireSession(deps.sessionSecret));

  router.get('/groups', async (req, res, next) => {
    try {
      const session = sessionOf(req);

      const groups = await withTenantTransaction(deps.db, session.organisationId, (trx) =>
        findGroupsForOrganisation(trx),
      );

      res.status(200).json({ data: groups });
    } catch (err) {
      next(err);
    }
  });

  // The management screen's detail view: who is in this group. Gated to
  // admin, unlike the plain list above, since a member list carries email
  // addresses, not just the group's own name and description.
  router.get('/groups/:groupId', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const groupId = req.params.groupId!;

      const result = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await isAdministrator(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Managing groups requires the admin or owner role.',
          );
        }

        const groups = await findGroupsForOrganisation(trx);
        const group = groups.find((candidate) => candidate.groupId === groupId);
        if (!group) {
          // Cross-tenant reads as absent under RLS (PRD.md §11.10, ADR-0015).
          throw new HttpProblemError(404, 'Not Found', 'No such group.');
        }

        const members = await findGroupMembersForGroup(trx, groupId);
        return { group, members };
      });

      res.status(200).json({ ...toBody(result.group), members: result.members });
    } catch (err) {
      next(err);
    }
  });

  router.post('/groups', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const input = parseBody(createSchema, req.body);

      const created = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await isAdministrator(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Managing groups requires the admin or owner role.',
          );
        }

        const key = await allocateGroupKey(trx, input.name);
        return createGroup(trx, {
          organisationId: session.organisationId,
          key,
          name: input.name,
          description: input.description ?? null,
        });
      });

      res.status(201).json(toBody(created));
    } catch (err) {
      next(err);
    }
  });

  router.patch('/groups/:groupId', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const groupId = req.params.groupId!;
      const patch = parseBody(patchSchema, req.body);

      const updated = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await isAdministrator(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Managing groups requires the admin or owner role.',
          );
        }

        const group = await updateGroup(trx, groupId, patch);
        if (!group) {
          throw new HttpProblemError(404, 'Not Found', 'No such group.');
        }
        return group;
      });

      res.status(200).json(toBody(updated));
    } catch (err) {
      next(err);
    }
  });

  router.delete('/groups/:groupId', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const groupId = req.params.groupId!;

      await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await isAdministrator(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Managing groups requires the admin or owner role.',
          );
        }

        let deleted: boolean;
        try {
          deleted = await deleteGroup(trx, groupId);
        } catch (err) {
          if (isForeignKeyViolation(err)) {
            throw new HttpProblemError(
              409,
              'Conflict',
              'This group cannot be deleted while a process definition or an assigned task still references it.',
            );
          }
          throw err;
        }

        if (!deleted) {
          throw new HttpProblemError(404, 'Not Found', 'No such group.');
        }
      });

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post('/groups/:groupId/members', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const groupId = req.params.groupId!;
      const body = parseBody(addMemberSchema, req.body);

      const members = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await isAdministrator(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Managing groups requires the admin or owner role.',
          );
        }

        const groups = await findGroupsForOrganisation(trx);
        if (!groups.some((candidate) => candidate.groupId === groupId)) {
          throw new HttpProblemError(404, 'Not Found', 'No such group.');
        }

        // users has no organisation column of its own, so nothing else on
        // this path would otherwise refuse a user id belonging to no
        // membership here at all, active or removed.
        if (!(await findOrganisationMemberByUserId(trx, body.userId))) {
          throw new HttpProblemError(404, 'Not Found', 'No such member of this organisation.');
        }

        await ensureGroupMember(trx, {
          organisationId: session.organisationId,
          groupId,
          userId: body.userId,
        });
        return findGroupMembersForGroup(trx, groupId);
      });

      res.status(200).json({ members });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/groups/:groupId/members/:userId', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const groupId = req.params.groupId!;
      const userId = req.params.userId!;

      await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await isAdministrator(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Managing groups requires the admin or owner role.',
          );
        }

        const removed = await removeGroupMember(trx, groupId, userId);
        if (!removed) {
          throw new HttpProblemError(404, 'Not Found', 'No such member of this group.');
        }
      });

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
