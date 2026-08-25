import {
  ensureDevUser,
  findIdentityProviderByEmailDomain,
  findMembershipsForUser,
  findUserByIdentity,
  findUserById,
  findOrganisationMemberByUserId,
  createUserWithIdentity,
  touchLastLogin,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import type { OrganisationRole } from '@orgflow/types';
import { Router } from 'express';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';

import { ensureLaptopRequestSeeded } from '../seed/laptop-request.js';
import { HttpProblemError } from '../middleware/error-handler.js';
import {
  buildAuthorizationRequestUrl,
  client,
  discoverOidc,
  type OidcProviderConfig,
} from '../auth/oidc-client.js';
import { clearFlowCookie, readFlowCookie, setFlowCookie } from '../auth/flow-cookie.js';
import {
  buildSessionClaims,
  createSessionToken,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from '../auth/session.js';

export interface AuthDeps {
  db: Kysely<Database>;
  mongoClient: MongoClient;
  sessionSecret: string;
  isLocal: boolean;
  webUrl: string;
  apiBaseUrl: string;
  platformOidc?: OidcProviderConfig | undefined;
}

function emailDomain(email: string): string | null {
  return email.split('@')[1]?.toLowerCase() ?? null;
}

async function resolveProviderForEmail(
  deps: AuthDeps,
  email: string,
): Promise<{
  displayName: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
} | null> {
  const orgProvider = await findIdentityProviderByEmailDomain(deps.db, email);
  if (orgProvider) {
    // clientSecretRef is a Secrets Manager ARN (PRD.md §2.1), never the
    // secret itself; resolving it is deployment infrastructure not built
    // yet, so an organisation-specific provider cannot complete a live
    // exchange locally. It is still returned for /auth/providers so the
    // endpoint reflects real configuration.
    return {
      displayName: orgProvider.displayName,
      issuerUrl: orgProvider.issuerUrl,
      clientId: orgProvider.clientId,
      clientSecret: '',
    };
  }

  if (deps.platformOidc) {
    return {
      displayName: 'Google',
      issuerUrl: deps.platformOidc.issuerUrl,
      clientId: deps.platformOidc.clientId,
      clientSecret: deps.platformOidc.clientSecret,
    };
  }

  return null;
}

export function createAuthRouter(deps: AuthDeps): Router {
  const router = Router();

  // PRD.md §11.1: resolve IdP for an email domain.
  router.get('/auth/providers', async (req, res, next) => {
    try {
      const email = typeof req.query.email === 'string' ? req.query.email : '';
      if (!emailDomain(email)) {
        throw new HttpProblemError(
          400,
          'Bad Request',
          'A valid email query parameter is required.',
        );
      }

      const provider = await resolveProviderForEmail(deps, email);
      if (!provider) {
        res.status(200).json({ provider: null });
        return;
      }

      res.status(200).json({
        provider: {
          type: 'oidc',
          displayName: provider.displayName,
          issuerUrl: provider.issuerUrl,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // PRD.md §12.1 steps 1-4: begin the Authorization Code + PKCE flow.
  router.get('/auth/login', async (req, res, next) => {
    try {
      const email = typeof req.query.email === 'string' ? req.query.email : '';
      const domain = emailDomain(email);
      if (!domain) {
        throw new HttpProblemError(
          400,
          'Bad Request',
          'A valid email query parameter is required.',
        );
      }

      const provider = await resolveProviderForEmail(deps, email);
      if (!provider || !provider.clientSecret) {
        throw new HttpProblemError(
          404,
          'Not Found',
          'No usable identity provider is configured for this email domain.',
        );
      }

      const config = await discoverOidc({
        issuerUrl: provider.issuerUrl,
        clientId: provider.clientId,
        clientSecret: provider.clientSecret,
      });

      const state = client.randomState();
      const nonce = client.randomNonce();
      const codeVerifier = client.randomPKCECodeVerifier();
      const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

      setFlowCookie(
        res,
        {
          state,
          nonce,
          codeVerifier,
          email,
          issuerUrl: provider.issuerUrl,
          clientId: provider.clientId,
          clientSecret: provider.clientSecret,
        },
        !deps.isLocal,
      );

      const authorizationUrl = buildAuthorizationRequestUrl(config, {
        redirectUri: `${deps.apiBaseUrl}/api/v1/auth/callback`,
        state,
        nonce,
        codeChallenge,
        hostedDomain: domain,
      });

      res.redirect(authorizationUrl.toString());
    } catch (err) {
      next(err);
    }
  });

  // PRD.md §12.1 steps 5-9.
  router.get('/auth/callback', async (req, res, next) => {
    try {
      const flow = readFlowCookie(req);
      if (!flow) {
        throw new HttpProblemError(400, 'Bad Request', 'No authentication attempt in progress.');
      }
      clearFlowCookie(res);

      const config = await discoverOidc({
        issuerUrl: flow.issuerUrl,
        clientId: flow.clientId,
        clientSecret: flow.clientSecret,
      });

      const currentUrl = new URL(req.originalUrl, deps.apiBaseUrl);
      const tokens = await client.authorizationCodeGrant(config, currentUrl, {
        expectedState: flow.state,
        expectedNonce: flow.nonce,
        pkceCodeVerifier: flow.codeVerifier,
      });

      const claims = tokens.claims();
      if (!claims || typeof claims.sub !== 'string') {
        throw new HttpProblemError(
          401,
          'Unauthorized',
          'The identity provider did not return a valid ID token.',
        );
      }
      if (claims.email_verified !== true) {
        throw new HttpProblemError(
          401,
          'Unauthorized',
          'The identity provider email is not verified.',
        );
      }

      const expectedDomain = emailDomain(flow.email);
      if (expectedDomain && claims.hd !== expectedDomain) {
        throw new HttpProblemError(
          401,
          'Unauthorized',
          'The account domain does not match the organisation configured for this email.',
        );
      }

      const existing = await findUserByIdentity(deps.db, flow.issuerUrl, claims.sub);
      const user =
        existing?.user ??
        (await createUserWithIdentity(deps.db, {
          email: typeof claims.email === 'string' ? claims.email : flow.email,
          displayName: typeof claims.name === 'string' ? claims.name : flow.email,
          avatarUrl: typeof claims.picture === 'string' ? claims.picture : null,
          issuer: flow.issuerUrl,
          subject: claims.sub,
        }));

      await touchLastLogin(deps.db, user.userId);

      const memberships = await findMembershipsForUser(deps.db, user.userId);
      const single = memberships.length === 1 ? memberships[0] : undefined;

      const sessionClaims = buildSessionClaims(
        user.userId,
        single?.organisationId ?? null,
        single?.roles ?? [],
      );
      const token = await createSessionToken(deps.sessionSecret, sessionClaims);

      res.cookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: !deps.isLocal,
        sameSite: 'lax',
        path: '/',
        expires: new Date(sessionClaims.expiresAt),
      });

      res.redirect(deps.webUrl);
    } catch (err) {
      next(err);
    }
  });

  // Local only; fails closed outside ORGFLOW_ENV=local (GOV-STANDARDS.md §6.2).
  router.post('/auth/dev-login', async (req, res, next) => {
    try {
      if (!deps.isLocal) {
        res.status(404).end();
        return;
      }

      const { user, membership } = await ensureDevUser(deps.db);
      await touchLastLogin(deps.db, user.userId);

      // Seeds the Laptop Request definition, its IT Support group and a
      // line manager for the dev user, so the local environment has a real
      // process to run end to end. Idempotent, and local-only by virtue of
      // sitting behind the same guard as the rest of this route.
      const seeded = await ensureLaptopRequestSeeded(deps.db, deps.mongoClient, {
        organisationId: membership.organisationId,
        ownerUserId: user.userId,
      });

      // The approval journey needs two people, because the whole point of an
      // approval is that somebody other than the requester makes it. The
      // seed already creates the line manager the Laptop Request assigns to;
      // without a way to sign in as them, the approve, reject and return
      // paths cannot be exercised in a browser at all, only through forged
      // session tokens in the API tests.
      //
      // This is not a way to become an arbitrary user: the only alternative
      // is the seeded manager, and the whole route is already dead outside
      // ORGFLOW_ENV=local.
      const wantsManager =
        typeof req.body === 'object' &&
        req.body !== null &&
        (req.body as { as?: unknown }).as === 'manager';

      const signedIn = wantsManager
        ? await resolveSeededManager(deps.db, membership.organisationId, seeded.lineManagerUserId)
        : { user, roles: membership.roles };

      const sessionClaims = buildSessionClaims(
        signedIn.user.userId,
        membership.organisationId,
        signedIn.roles,
      );
      const token = await createSessionToken(deps.sessionSecret, sessionClaims);

      res.cookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: !deps.isLocal,
        sameSite: 'lax',
        path: '/',
        expires: new Date(sessionClaims.expiresAt),
      });

      res.status(200).json({
        user: {
          userId: signedIn.user.userId,
          email: signedIn.user.email,
          displayName: signedIn.user.displayName,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/auth/session', async (req, res, next) => {
    try {
      const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
      const claims = token ? await verifySessionToken(deps.sessionSecret, token) : null;

      if (!claims) {
        throw new HttpProblemError(401, 'Unauthorized', 'No active session.');
      }

      const user = await findUserById(deps.db, claims.userId);
      if (!user) {
        throw new HttpProblemError(401, 'Unauthorized', 'No active session.');
      }

      res.status(200).json({
        user: {
          userId: user.userId,
          email: user.email,
          displayName: user.displayName,
          // ADR-0026: read fresh from the database rather than carried in
          // the session claims, the same staleness reasoning every other
          // authorisation check in this codebase already follows (a
          // session can be up to twelve hours old under ADR-0010).
          isPlatformAdmin: user.isPlatformAdmin,
        },
        organisationId: claims.organisationId,
        roles: claims.roles,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/auth/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    res.status(204).end();
  });

  return router;
}

// The seeded line manager, resolved for the local-only dev login above.
// Their roles come from organisation_members rather than being assumed,
// for the same reason every other authorisation decision reads membership
// from the database: a role the seed happens to grant today is not a role
// this route should hardcode.
async function resolveSeededManager(
  db: Kysely<Database>,
  organisationId: string,
  managerUserId: string,
): Promise<{
  user: { userId: string; email: string; displayName: string };
  roles: OrganisationRole[];
}> {
  const manager = await findUserById(db, managerUserId);
  if (!manager) {
    throw new HttpProblemError(
      500,
      'Internal Server Error',
      'The seeded line manager does not exist.',
    );
  }

  const membership = await withTenantTransaction(db, organisationId, (trx) =>
    findOrganisationMemberByUserId(trx, managerUserId),
  );

  if (!membership) {
    throw new HttpProblemError(
      500,
      'Internal Server Error',
      'The seeded line manager is not a member of the development organisation.',
    );
  }

  return {
    user: { userId: manager.userId, email: manager.email, displayName: manager.displayName },
    roles: membership.roles,
  };
}
