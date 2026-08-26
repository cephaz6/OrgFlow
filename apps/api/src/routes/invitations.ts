import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  createInvitation,
  findInvitationByTokenHash,
  findInvitationsForCurrentTenant,
  findOrganisationById,
  findOrganisationMemberByUserId,
  findUserById,
  insertOrganisationMember,
  markInvitationAccepted,
  revokeInvitation,
  updateOrganisationMember,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import type { EmailMessage, EmailSender } from '@orgflow/email';
import type { DomainEventPublisher } from '@orgflow/events';
import type { DomainEvent, Invitation, InvitationPreview, OrganisationRole } from '@orgflow/types';
import { Router } from 'express';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import { buildSessionClaims, createSessionToken, SESSION_COOKIE_NAME } from '../auth/session.js';
import { isAdministrator } from '../cases/permissions.js';
import type { Logger } from '../logger.js';
import { parseBody } from '../lib/parse-body.js';
import { HttpProblemError } from '../middleware/error-handler.js';
import {
  requireSession,
  requireUserSession,
  sessionOf,
  userSessionOf,
} from '../middleware/require-session.js';

export interface InvitationsDeps {
  db: Kysely<Database>;
  sessionSecret: string;
  publisher: DomainEventPublisher;
  emailSender: EmailSender;
  logger: Logger;
  isLocal: boolean;
  // The web origin, for both the invite link and the redirect target after
  // acceptance. app.ts passes deps.corsOrigin, the same value auth.ts's
  // callback already redirects to.
  webUrl: string;
}

const ROLES = ['member', 'approver', 'processOwner', 'admin', 'owner'] as const;
const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

const listQuerySchema = z.object({
  query: z.string().min(1).optional(),
  // PRD.md §11.10: cursor-based pagination, ?limit&cursor.
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().min(1).optional(),
});

const createSchema = z.object({
  email: z.string().email(),
  // No .min(1): inviting somebody as a plain member, with no additional
  // role, is a real and common case, not an incomplete request.
  // normaliseRoles below is what guarantees 'member' ends up granted
  // either way, so an empty array here is meaningful input, not an error.
  roles: z.array(z.enum(ROLES)),
});

function normaliseRoles(roles: OrganisationRole[]): OrganisationRole[] {
  return roles.includes('member') ? roles : ['member', ...roles];
}

// A random token is emailed and never stored; only its SHA-256 lives in
// invitations.token_hash. The same shape a session secret protects a
// password: the database holding the hash is not enough on its own to
// impersonate the link, matching PRD.md §2's column name and this being the
// one column in the table that must never be selected back out to a caller
// (toDomain in packages/db/src/repositories/invitations.ts omits it by
// construction, not by filtering).
function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildInvitationEmail(facts: {
  organisationName: string;
  invitedByDisplayName: string;
  inviteUrl: string;
}): EmailMessage {
  const subject = `You have been invited to join ${facts.organisationName} on OrgFlow`;

  const textBody = [
    `${facts.invitedByDisplayName} has invited you to join ${facts.organisationName} on OrgFlow.`,
    '',
    `Accept the invitation: ${facts.inviteUrl}`,
    '',
    'This link expires in seven days.',
  ].join('\n');

  const htmlBody = [
    `<p>${escapeHtml(facts.invitedByDisplayName)} has invited you to join ${escapeHtml(facts.organisationName)} on OrgFlow.</p>`,
    `<p><a href="${escapeHtml(facts.inviteUrl)}">Accept the invitation</a></p>`,
    '<p>This link expires in seven days.</p>',
  ].join('');

  return { to: '', subject, textBody, htmlBody };
}

function toBody(invitation: Invitation) {
  return {
    invitationId: invitation.invitationId,
    email: invitation.email,
    roles: invitation.roles,
    invitedByUserId: invitation.invitedByUserId,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    revokedAt: invitation.revokedAt,
    createdAt: invitation.createdAt,
  };
}

// Express 5's route-param typing widens to string | string[] once a route
// is given more than one handler (the accept route's requireUserSession
// plus its async body), even though a named segment like :token can only
// ever parse as a single string. Narrowed explicitly rather than asserted
// away, since the alternative is passing whatever Express handed back
// straight into createHash, which throws an unhelpful TypeError instead of
// this route's own 400 if that assumption is ever wrong.
function paramString(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpProblemError(400, 'Bad Request', 'A token is required.');
  }
  return value;
}

function statusOf(invitation: Invitation): InvitationPreview['status'] {
  if (invitation.revokedAt) {
    return 'revoked';
  }
  if (invitation.acceptedAt) {
    return 'accepted';
  }
  if (new Date(invitation.expiresAt).getTime() < Date.now()) {
    return 'expired';
  }
  return 'pending';
}

// The event envelope every route in this codebase that publishes builds by
// hand (there is no shared constructor): apps/api/src/routes/tasks.ts's
// task.claimed publish is the template this follows.
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

// PRD.md §11.2's invitation endpoints, plus /invitations/:token and its
// accept, which the specification names as a screen (§13.1) without listing
// as a row in the API table; both are required for the screen to exist at
// all and are documented in ADR-0025 rather than silently added.
export function createInvitationsRouter(deps: InvitationsDeps): Router {
  const router = Router();

  // requireSession applied per-route rather than through a blanket
  // router.use, because the two public routes below (the token preview and
  // its accept) need a different, or no, session requirement, and
  // Express's router.use(path, fn) rebases req.path onto whatever comes
  // after the matched prefix. A regex written against the full path, tried
  // first, matched nothing there and let every request fall through to
  // full session gating regardless of route.
  router.post('/invitations', requireSession(deps.sessionSecret), async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const body = parseBody(createSchema, req.body);
      const roles = normaliseRoles(body.roles);

      const { raw, hash } = generateToken();
      const expiresAt = new Date(Date.now() + INVITATION_LIFETIME_MS);

      const result = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await isAdministrator(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Inviting members requires the admin or owner role.',
          );
        }

        let invitation: Invitation;
        try {
          invitation = await createInvitation(trx, {
            organisationId: session.organisationId,
            email: body.email,
            roles,
            tokenHash: hash,
            invitedByUserId: session.userId,
            expiresAt,
          });
        } catch (err) {
          // uq_invitations_pending (organisation_id, email) WHERE
          // accepted_at IS NULL AND revoked_at IS NULL: Postgres, not
          // application logic, is what actually prevents a second pending
          // invitation to the same address, so a 23505 here is the
          // expected shape of "already invited," not a fault.
          if (
            typeof err === 'object' &&
            err !== null &&
            'code' in err &&
            (err as { code: unknown }).code === '23505'
          ) {
            throw new HttpProblemError(
              409,
              'Conflict',
              'This email already has a pending invitation. Revoke it first to send a new one.',
            );
          }
          throw err;
        }

        const inviter = await findUserById(trx, session.userId);
        return { invitation, inviterName: inviter?.displayName ?? 'An administrator' };
      });

      const organisation = await findOrganisationById(deps.db, session.organisationId);
      const inviteUrl = `${deps.webUrl.replace(/\/$/, '')}/invitations/${raw}`;

      // Committed before the send is attempted, matching cases.ts's
      // publishOrLog reasoning: a delivery failure after the invitation
      // genuinely exists must not read as the invitation not existing. The
      // link is returned in the response either way, since email is the
      // convenience path and this is the only place the raw token is ever
      // available; nothing can reconstruct it from the stored hash.
      try {
        await deps.emailSender.send({
          ...buildInvitationEmail({
            organisationName: organisation?.name ?? 'your organisation',
            invitedByDisplayName: result.inviterName,
            inviteUrl,
          }),
          to: body.email,
        });
      } catch (err) {
        deps.logger.error(
          { err, invitationId: result.invitation.invitationId },
          'invitation email was not sent after the invitation was created',
        );
      }

      await publishOrLog(deps, [
        buildEvent({
          eventType: 'member.invited',
          organisationId: session.organisationId,
          actorUserId: session.userId,
          correlationId: req.correlationId,
          payload: { email: body.email, roles },
        }),
      ]);

      res.status(201).json({ invitation: toBody(result.invitation), inviteUrl });
    } catch (err) {
      next(err);
    }
  });

  router.get('/invitations', requireSession(deps.sessionSecret), async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const filter = parseBody(listQuerySchema, req.query as Record<string, unknown>);

      const page = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await isAdministrator(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Managing invitations requires the admin or owner role.',
          );
        }
        return findInvitationsForCurrentTenant(trx, filter);
      });

      res.status(200).json({
        invitations: page.invitations.map(toBody),
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/invitations/:id', requireSession(deps.sessionSecret), async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const invitationId = paramString(req.params.id);

      await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await isAdministrator(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Managing invitations requires the admin or owner role.',
          );
        }

        const revoked = await revokeInvitation(trx, invitationId);
        if (!revoked) {
          // Covers three cases identically: the id belongs to another
          // organisation (RLS makes the row invisible), it never existed,
          // or it was already accepted or revoked. None of the three is
          // something the caller needs distinguished from the others.
          throw new HttpProblemError(404, 'Not Found', 'No such pending invitation.');
        }
      });

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // Public: an invited person has no session yet, and this is what the
  // accept screen calls to render before asking them to sign in at all.
  router.get('/invitations/:token', async (req, res, next) => {
    try {
      const token = paramString(req.params.token);
      const hash = createHash('sha256').update(token).digest('hex');

      const invitation = await findInvitationByTokenHash(deps.db, hash);
      if (!invitation) {
        throw new HttpProblemError(404, 'Not Found', 'No such invitation.');
      }

      const [organisation, inviter] = await Promise.all([
        findOrganisationById(deps.db, invitation.organisationId),
        findUserById(deps.db, invitation.invitedByUserId),
      ]);

      const preview: InvitationPreview = {
        organisationName: organisation?.name ?? 'this organisation',
        invitedByDisplayName: inviter?.displayName ?? 'An administrator',
        email: invitation.email,
        roles: invitation.roles,
        expiresAt: invitation.expiresAt,
        status: statusOf(invitation),
      };

      res.status(200).json({ invitation: preview });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/invitations/:token/accept',
    requireUserSession(deps.sessionSecret),
    async (req, res, next) => {
      try {
        const userSession = userSessionOf(req);
        const token = paramString(req.params.token);
        const hash = createHash('sha256').update(token).digest('hex');

        const invitation = await findInvitationByTokenHash(deps.db, hash);
        if (!invitation) {
          throw new HttpProblemError(404, 'Not Found', 'No such invitation.');
        }

        const status = statusOf(invitation);
        if (status !== 'pending') {
          // 410 rather than 404: the link existed and led somewhere, and
          // telling the caller it was already used or has timed out is
          // more useful than a bare "not found", which reads as a wrong
          // link rather than a resolved one.
          throw new HttpProblemError(
            410,
            'Gone',
            status === 'accepted'
              ? 'This invitation has already been accepted.'
              : status === 'revoked'
                ? 'This invitation has been withdrawn.'
                : 'This invitation has expired.',
          );
        }

        const user = await findUserById(deps.db, userSession.userId);
        if (!user) {
          throw new HttpProblemError(401, 'Unauthorized', 'No active session.');
        }

        if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            `Sign in with ${invitation.email} to accept this invitation.`,
          );
        }

        const finalRoles = await withTenantTransaction(
          deps.db,
          invitation.organisationId,
          async (trx) => {
            const existing = await findOrganisationMemberByUserId(trx, userSession.userId);

            if (existing) {
              // Reactivates a previously removed member, or simply resets
              // roles for somebody already active who was invited again.
              // ADR-0024's last-owner guard does not apply here: this path
              // only ever grants or restores membership, never removes the
              // organisation's last owner.
              const updated = await updateOrganisationMember(trx, userSession.userId, {
                roles: invitation.roles,
                status: 'active',
              });
              return updated!.roles;
            }

            const created = await insertOrganisationMember(trx, {
              organisationId: invitation.organisationId,
              userId: userSession.userId,
              roles: invitation.roles,
            });
            return created.roles;
          },
        );

        // The invitation's own accepted_at write happens outside the
        // membership transaction above on purpose: it is scoped to
        // invitation.organisationId too, but withTenantTransaction commits
        // per call, and a second, tiny transaction here keeps the first one
        // free of an UPDATE unrelated to the membership row it is really
        // about. Both still complete before the response, so a client
        // reading GET /invitations/:token immediately after never sees a
        // stale 'pending' status.
        await withTenantTransaction(deps.db, invitation.organisationId, (trx) =>
          markInvitationAccepted(trx, invitation.invitationId),
        );

        // ADR-0010's rotation-on-privilege-change, applied to the other
        // event that changes what a session may do: acceptance is the
        // moment this session goes from no organisation, or a different
        // one, to this one.
        const claims = buildSessionClaims(
          userSession.userId,
          invitation.organisationId,
          finalRoles,
        );
        const newToken = await createSessionToken(deps.sessionSecret, claims);

        res.cookie(SESSION_COOKIE_NAME, newToken, {
          httpOnly: true,
          secure: !deps.isLocal,
          sameSite: 'lax',
          path: '/',
          expires: new Date(claims.expiresAt),
        });

        await publishOrLog(deps, [
          buildEvent({
            eventType: 'member.joined',
            organisationId: invitation.organisationId,
            actorUserId: userSession.userId,
            correlationId: req.correlationId,
            payload: { userId: userSession.userId },
          }),
        ]);

        const organisation = await findOrganisationById(deps.db, invitation.organisationId);
        res.status(200).json({
          organisationId: invitation.organisationId,
          organisationName: organisation?.name ?? null,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

// Same reasoning as cases.ts's publishOrLog: the membership and the
// invitation's accepted_at are already committed by the time this runs, so
// a publish failure must not turn a successful join into an error response.
async function publishOrLog(deps: InvitationsDeps, events: DomainEvent[]): Promise<void> {
  try {
    await deps.publisher.publish(events);
  } catch (err) {
    deps.logger.error(
      { err, eventIds: events.map((event) => event.eventId) },
      'domain events were not published after the transaction committed',
    );
  }
}
