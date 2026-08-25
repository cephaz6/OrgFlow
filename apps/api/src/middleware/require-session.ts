import type { OrganisationRole } from '@orgflow/types';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { HttpProblemError } from './error-handler.js';
import { SESSION_COOKIE_NAME, verifySessionToken } from '../auth/session.js';

export interface RequestSession {
  userId: string;
  organisationId: string;
  roles: OrganisationRole[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: RequestSession;
    }
  }
}

// CLAUDE.md §3: tenant context comes from the authenticated session, never
// from a body, query parameter or header. This middleware is the only place
// an organisationId enters a request, and every tenant-scoped route sits
// behind it, so a handler cannot reach the database without one.
export function requireSession(sessionSecret: string): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
      const claims = token ? await verifySessionToken(sessionSecret, token) : null;

      if (!claims) {
        throw new HttpProblemError(401, 'Unauthorized', 'No active session.');
      }

      if (!claims.organisationId) {
        // Authenticated but with no organisation chosen yet, which PRD.md
        // §11.1 resolves through /auth/switch-organisation. A 403 is
        // correct here rather than a 404: nothing about a specific
        // resource is being confirmed or denied.
        throw new HttpProblemError(
          403,
          'Forbidden',
          'No active organisation. Select one before using this endpoint.',
        );
      }

      req.session = {
        userId: claims.userId,
        organisationId: claims.organisationId,
        roles: claims.roles,
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}

// Narrows away the optional after requireSession has run. A route mounted
// behind that middleware always has one, so a missing session here is a
// wiring mistake, not a request the client can provoke.
export function sessionOf(req: Request): RequestSession {
  if (!req.session) {
    throw new Error('requireSession must be mounted before this handler.');
  }
  return req.session;
}

export interface RequestUserSession {
  userId: string;
  organisationId: string | null;
  roles: OrganisationRole[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userSession?: RequestUserSession;
    }
  }
}

// requireSession's counterpart for the one route that genuinely cannot
// demand an organisation: accepting an invitation is how a session first
// gets one. PRD.md §12.1 step 7 already produces a session with
// organisationId: null when sign-in resolves to zero or several
// memberships, and nothing currently lets that session go anywhere, since
// /auth/switch-organisation is unbuilt scope. Accepting an invitation is
// the other way a null-organisation session becomes a real one.
//
// Still requires a genuine, verified session; only the organisationId
// check requireSession makes is skipped. An invitation cannot be accepted
// by an anonymous request, only by one that has already completed sign-in
// (PRD.md §12.1 steps 1-7 by way of a real identity provider, or the
// seeded dev-login locally).
export function requireUserSession(sessionSecret: string): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
      const claims = token ? await verifySessionToken(sessionSecret, token) : null;

      if (!claims) {
        throw new HttpProblemError(401, 'Unauthorized', 'No active session.');
      }

      req.userSession = {
        userId: claims.userId,
        organisationId: claims.organisationId,
        roles: claims.roles,
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}

export function userSessionOf(req: Request): RequestUserSession {
  if (!req.userSession) {
    throw new Error('requireUserSession must be mounted before this handler.');
  }
  return req.userSession;
}
