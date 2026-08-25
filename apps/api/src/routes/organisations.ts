import { randomUUID } from 'node:crypto';

import {
  createOrganisation,
  findOrganisationById,
  findOrganisationMemberByUserId,
  findUserById,
  insertOrganisationMember,
  updateOrganisation,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import type { DomainEventPublisher } from '@orgflow/events';
import type { DomainEvent } from '@orgflow/types';
import { Router } from 'express';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import { buildSessionClaims, createSessionToken, SESSION_COOKIE_NAME } from '../auth/session.js';
import { parseBody } from '../lib/parse-body.js';
import type { Logger } from '../logger.js';
import { HttpProblemError } from '../middleware/error-handler.js';
import {
  requireSession,
  requireUserSession,
  sessionOf,
  userSessionOf,
} from '../middleware/require-session.js';

export interface OrganisationsDeps {
  db: Kysely<Database>;
  sessionSecret: string;
  publisher: DomainEventPublisher;
  logger: Logger;
  isLocal: boolean;
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
});

const updateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    branding: z.record(z.string(), z.unknown()).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

// A readable, URL-safe slug derived from the name, not asked for
// separately: nothing downstream (branding, an eventual custom domain)
// depends on the slug being chosen deliberately rather than derived, and
// asking a platform admin to invent one is one more thing to get wrong for
// no benefit.
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildEvent(input: {
  eventType: DomainEvent['eventType'];
  organisationId: string;
  actorUserId: string | null;
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

// PRD-SUMMARY.md §3 lists organisation creation as "self-serve," but that
// was never actually specified anywhere in PRD.md: no schema, no role, no
// API gate. ADR-0026 records the deliberate deviation: creation is gated
// to a platform admin (users.is_platform_admin, global, not organisation-
// scoped), decided directly with the operator rather than assumed.
export function createOrganisationsRouter(deps: OrganisationsDeps): Router {
  const router = Router();

  // requireUserSession, not requireSession: creating your first
  // organisation is the other way a session with organisationId: null
  // (PRD.md §12.1 step 7's zero-membership case) gets one, the same
  // reasoning ADR-0025 already applies to accepting an invitation.
  router.post('/organisations', requireUserSession(deps.sessionSecret), async (req, res, next) => {
    try {
      const userSession = userSessionOf(req);
      const body = parseBody(createSchema, req.body);

      const user = await findUserById(deps.db, userSession.userId);
      if (!user) {
        throw new HttpProblemError(401, 'Unauthorized', 'No active session.');
      }
      if (!user.isPlatformAdmin) {
        // Not a tenant secret, so 403 rather than 404 (PRD.md §11.10's
        // reasoning is about cross-tenant disclosure; this route sits
        // above every tenant, so there is nothing to disclose by refusing
        // plainly).
        throw new HttpProblemError(
          403,
          'Forbidden',
          'Creating an organisation requires platform admin access.',
        );
      }

      let organisation;
      try {
        organisation = await createOrganisation(deps.db, {
          name: body.name,
          slug: slugify(body.name),
          createdByUserId: userSession.userId,
        });
      } catch (err) {
        // organisations_slug_key: two organisations named the same thing
        // derive the same slug. Surfaced as a clean 409 rather than a raw
        // constraint violation, the same shape invitations.ts already
        // gives its own unique-index conflict.
        if (
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code: unknown }).code === '23505'
        ) {
          throw new HttpProblemError(
            409,
            'Conflict',
            'An organisation with a name that similar already exists.',
          );
        }
        throw err;
      }

      // The creating platform admin becomes this organisation's first
      // owner, the same shape the dev seed already uses: somebody has to
      // hold every role to hand any of them onward, and "the creator" is
      // the only identity this request has to work with.
      const roles = ['owner', 'admin', 'processOwner', 'approver', 'member'] as const;
      await withTenantTransaction(deps.db, organisation.organisationId, (trx) =>
        insertOrganisationMember(trx, {
          organisationId: organisation.organisationId,
          userId: userSession.userId,
          roles: [...roles],
        }),
      );

      // ADR-0010's rotation-on-privilege-change: this request is the
      // moment the session goes from no organisation to this one.
      const claims = buildSessionClaims(userSession.userId, organisation.organisationId, [
        ...roles,
      ]);
      const token = await createSessionToken(deps.sessionSecret, claims);

      res.cookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: !deps.isLocal,
        sameSite: 'lax',
        path: '/',
        expires: new Date(claims.expiresAt),
      });

      try {
        await deps.publisher.publish([
          buildEvent({
            eventType: 'organisation.created',
            organisationId: organisation.organisationId,
            actorUserId: userSession.userId,
            correlationId: req.correlationId,
            payload: { name: organisation.name },
          }),
        ]);
      } catch (err) {
        deps.logger.error(
          { err, organisationId: organisation.organisationId },
          'organisation.created was not published after the organisation was created',
        );
      }

      res.status(201).json({ organisation });
    } catch (err) {
      next(err);
    }
  });

  router.get(
    '/organisations/current',
    requireSession(deps.sessionSecret),
    async (req, res, next) => {
      try {
        const session = sessionOf(req);
        const organisation = await findOrganisationById(deps.db, session.organisationId);
        if (!organisation) {
          throw new HttpProblemError(404, 'Not Found', 'No such organisation.');
        }
        res.status(200).json({ organisation });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/organisations/current',
    requireSession(deps.sessionSecret),
    async (req, res, next) => {
      try {
        const session = sessionOf(req);
        const body = parseBody(updateSchema, req.body);

        const organisation = await withTenantTransaction(
          deps.db,
          session.organisationId,
          async (trx) => {
            // Owner only, not admin: PRD.md §12.2 gives "manage
            // organisation settings" to owner specifically, one step above
            // admin's "manage members, groups, IdP, retention."
            const member = await findOrganisationMemberByUserId(trx, session.userId);
            if (!member?.roles.includes('owner')) {
              throw new HttpProblemError(
                403,
                'Forbidden',
                'Changing organisation settings requires the owner role.',
              );
            }

            return updateOrganisation(deps.db, session.organisationId, body);
          },
        );

        if (!organisation) {
          throw new HttpProblemError(404, 'Not Found', 'No such organisation.');
        }

        res.status(200).json({ organisation });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
