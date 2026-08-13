import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb } from './connection.js';
import {
  createIdentityProvider,
  findIdentityProviderByEmailDomain,
} from './repositories/identity-providers.js';
import { createOrganisation } from './repositories/organisations.js';
import { createUserWithIdentity } from './repositories/users.js';
import type { Database } from './schema.js';
import { generateId } from './uuid.js';

// Local Docker Compose credentials, not a secret (ADR-0007).
const CONNECTION_STRING = 'postgres://orgflow:orgflow@localhost:5432/orgflow';

describe('findIdentityProviderByEmailDomain', () => {
  let db: Kysely<Database>;
  let organisationId: string;
  let userId: string;

  beforeAll(async () => {
    db = createDb({ connectionString: CONNECTION_STRING });

    const user = await createUserWithIdentity(db, {
      email: `idp-test-${generateId()}@example.invalid`,
      displayName: 'IdP test user',
      issuer: 'urn:orgflow:test',
      subject: `idp-test-${generateId()}`,
    });
    userId = user.userId;

    const organisation = await createOrganisation(db, {
      name: 'IdP test tenant',
      slug: `idp-test-${generateId()}`,
      createdByUserId: userId,
    });
    organisationId = organisation.organisationId;

    await createIdentityProvider(db, {
      organisationId,
      displayName: 'Test Workspace',
      issuerUrl: 'https://accounts.google.com',
      clientId: 'test-client-id',
      clientSecretRef: 'arn:aws:secretsmanager:eu-west-2:000000000000:secret:test',
      emailDomains: ['idp-test-domain.example'],
    });
  });

  afterAll(async () => {
    await db
      .deleteFrom('identity_providers')
      .where('organisation_id', '=', organisationId)
      .execute();
    await db.deleteFrom('organisations').where('organisation_id', '=', organisationId).execute();
    await db.deleteFrom('users').where('user_id', '=', userId).execute();
    await db.destroy();
  });

  it('finds a provider whose email_domains array contains the domain', async () => {
    const found = await findIdentityProviderByEmailDomain(db, 'someone@idp-test-domain.example');

    expect(found).not.toBeNull();
    expect(found?.organisationId).toBe(organisationId);
    expect(found?.displayName).toBe('Test Workspace');
  });

  it('returns null for a domain with no configured provider', async () => {
    const found = await findIdentityProviderByEmailDomain(
      db,
      'someone@unconfigured-domain.example',
    );

    expect(found).toBeNull();
  });
});
