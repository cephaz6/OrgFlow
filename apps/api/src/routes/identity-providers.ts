import {
  createIdentityProvider,
  deleteIdentityProvider,
  findIdentityProvidersForOrganisation,
  updateIdentityProvider,
  withTenantTransaction,
  type Database,
  type IdentityProviderRecord,
} from '@orgflow/db';
import { Router } from 'express';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import { isAdministrator } from '../cases/permissions.js';
import { parseBody } from '../lib/parse-body.js';
import { HttpProblemError } from '../middleware/error-handler.js';
import { requireSession, sessionOf } from '../middleware/require-session.js';

export interface IdentityProvidersDeps {
  db: Kysely<Database>;
  sessionSecret: string;
}

// A Secrets Manager ARN, matching the shape client_secret_ref is documented
// to hold everywhere else it appears (ADR-0007, DataStack's databaseUrlSecret
// follows the identical placeholder-ref pattern): this route never sees, and
// must never be able to accept, the raw client secret itself. The regex is a
// defence against the mistake of pasting the secret value into this field
// by accident, not a substitute for the AWS SDK actually resolving it, which
// remains the documented, separate follow-up (server.md, ADR-0001) that a
// live login against an organisation-specific provider still needs.
const SECRET_ARN_PATTERN = /^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:.+$/;

const EMAIL_DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const emailDomainSchema = z
  .string()
  .min(1)
  .max(255)
  .transform((value) => value.toLowerCase())
  .refine((value) => EMAIL_DOMAIN_PATTERN.test(value), {
    message: 'Each email domain must look like example.com.',
  });

const createSchema = z.object({
  displayName: z.string().min(1).max(200),
  issuerUrl: z
    .string()
    .url()
    .refine((value) => value.startsWith('https://'), {
      message: 'The issuer URL must use https.',
    }),
  clientId: z.string().min(1).max(500),
  clientSecretRef: z.string().regex(SECRET_ARN_PATTERN, {
    message:
      'clientSecretRef must be the Secrets Manager ARN of the client secret, not the secret itself.',
  }),
  emailDomains: z.array(emailDomainSchema).min(1),
});

const patchSchema = z
  .object({
    displayName: z.string().min(1).max(200).optional(),
    issuerUrl: z
      .string()
      .url()
      .refine((value) => value.startsWith('https://'), {
        message: 'The issuer URL must use https.',
      })
      .optional(),
    clientId: z.string().min(1).max(500).optional(),
    clientSecretRef: z
      .string()
      .regex(SECRET_ARN_PATTERN, {
        message:
          'clientSecretRef must be the Secrets Manager ARN of the client secret, not the secret itself.',
      })
      .optional(),
    emailDomains: z.array(emailDomainSchema).min(1).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

function toBody(provider: IdentityProviderRecord) {
  return {
    providerId: provider.providerId,
    type: provider.type,
    displayName: provider.displayName,
    issuerUrl: provider.issuerUrl,
    clientId: provider.clientId,
    clientSecretRef: provider.clientSecretRef,
    emailDomains: provider.emailDomains,
    enabled: provider.enabled,
  };
}

// PRD.md §12.2 gives identity configuration to admin and owner, the same
// gate members.ts already uses for member management: both are ways to
// change who can sign in as whom, not something a process owner needs.
export function createIdentityProvidersRouter(deps: IdentityProvidersDeps): Router {
  const router = Router();

  router.use('/identity-providers', requireSession(deps.sessionSecret));

  router.get('/identity-providers', async (req, res, next) => {
    try {
      const session = sessionOf(req);

      const providers = await withTenantTransaction(
        deps.db,
        session.organisationId,
        async (trx) => {
          if (!(await isAdministrator(trx, session))) {
            throw new HttpProblemError(
              403,
              'Forbidden',
              'Managing identity providers requires the admin or owner role.',
            );
          }

          return findIdentityProvidersForOrganisation(trx);
        },
      );

      res.status(200).json({ providers: providers.map(toBody) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/identity-providers', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const input = parseBody(createSchema, req.body);

      const created = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await isAdministrator(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Managing identity providers requires the admin or owner role.',
          );
        }

        return createIdentityProvider(trx, {
          organisationId: session.organisationId,
          ...input,
        });
      });

      res.status(201).json(toBody(created));
    } catch (err) {
      next(err);
    }
  });

  router.patch('/identity-providers/:providerId', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const providerId = req.params.providerId!;
      const patch = parseBody(patchSchema, req.body);

      const updated = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await isAdministrator(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Managing identity providers requires the admin or owner role.',
          );
        }

        const provider = await updateIdentityProvider(trx, providerId, patch);
        if (!provider) {
          // Cross-tenant reads as absent under RLS (PRD.md §11.10, ADR-0015).
          throw new HttpProblemError(404, 'Not Found', 'No such identity provider.');
        }
        return provider;
      });

      res.status(200).json(toBody(updated));
    } catch (err) {
      next(err);
    }
  });

  router.delete('/identity-providers/:providerId', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const providerId = req.params.providerId!;

      await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await isAdministrator(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Managing identity providers requires the admin or owner role.',
          );
        }

        const deleted = await deleteIdentityProvider(trx, providerId);
        if (!deleted) {
          throw new HttpProblemError(404, 'Not Found', 'No such identity provider.');
        }
      });

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
