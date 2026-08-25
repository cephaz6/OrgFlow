import { findGroupsForOrganisation, withTenantTransaction } from '@orgflow/db';
import type { Database } from '@orgflow/db';
import { Router } from 'express';
import type { Kysely } from 'kysely';

import { requireSession, sessionOf } from '../middleware/require-session.js';

export interface GroupsDeps {
  db: Kysely<Database>;
  sessionSecret: string;
}

// Read-only picklist for now: any signed-in member can see the
// organisation's groups (ADR-0026's owning-group select needs this),
// creating or renaming a group is not yet a product surface.
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

  return router;
}
