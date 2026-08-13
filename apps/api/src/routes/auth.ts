import {
  ensureDevUser,
  findIdentityProviderByEmailDomain,
  findMembershipsForUser,
  findUserByIdentity,
  findUserById,
  createUserWithIdentity,
  touchLastLogin,
  type Database,
} from '@orgflow/db';
import { Router } from 'express';
import type { Kysely } from 'kysely';

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
        redirectUri: `${deps.apiBaseUrl}/auth/callback`,
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

      const sessionClaims = buildSessionClaims(
        user.userId,
        membership.organisationId,
        membership.roles,
      );
      const token = await createSessionToken(deps.sessionSecret, sessionClaims);

      res.cookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: !deps.isLocal,
        sameSite: 'lax',
        path: '/',
        expires: new Date(sessionClaims.expiresAt),
      });

      res
        .status(200)
        .json({ user: { userId: user.userId, email: user.email, displayName: user.displayName } });
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
        user: { userId: user.userId, email: user.email, displayName: user.displayName },
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
