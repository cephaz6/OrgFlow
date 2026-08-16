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
