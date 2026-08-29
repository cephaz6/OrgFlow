import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb } from '../connection.js';
import { createOrganisation } from './organisations.js';
import { createUserWithIdentity } from './users.js';
import {
  createIdentityProvider,
  deleteIdentityProvider,
  findIdentityProvidersForOrganisation,
  updateIdentityProvider,
} from './identity-providers.js';
import type { Database } from '../schema.js';
import { withTenantTransaction } from '../tenant-transaction.js';
import { generateId } from '../uuid.js';

// Unlike identity-providers.integration.test.ts (findIdentityProviderByEmailDomain,
// the ADR-0011 pre-tenant-context exception), everything exercised here runs
// through withTenantTransaction like an ordinary tenant-scoped repository
// function, which is what an admin session actually uses once it is
// authenticated (apps/api/src/routes/identity-providers.ts).
describe('identity provider CRUD, tenant-scoped', () => {
  let db: Kysely<Database>;
  let organisationId: string;
  let otherOrganisationId: string;

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });

    const user = await createUserWithIdentity(db, {
      email: `idp-crud-${generateId()}@example.invalid`,
      displayName: 'IdP CRUD test user',
      issuer: 'urn:orgflow:test',
      subject: `idp-crud-${generateId()}`,
    });

    const organisation = await createOrganisation(db, {
      name: 'IdP CRUD test tenant',
      slug: `idp-crud-${generateId()}`,
      createdByUserId: user.userId,
    });
    organisationId = organisation.organisationId;

    const otherOrganisation = await createOrganisation(db, {
      name: 'IdP CRUD other tenant',
      slug: `idp-crud-other-${generateId()}`,
      createdByUserId: user.userId,
    });
    otherOrganisationId = otherOrganisation.organisationId;
  });

  afterAll(async () => {
    await db
      .deleteFrom('identity_providers')
      .where('organisation_id', 'in', [organisationId, otherOrganisationId])
      .execute();
    await db
      .deleteFrom('organisations')
      .where('organisation_id', 'in', [organisationId, otherOrganisationId])
      .execute();
    await db.destroy();
  });

  it("lists only the current tenant's providers", async () => {
    await createIdentityProvider(db, {
      organisationId,
      displayName: 'Mine',
      issuerUrl: 'https://login.example.com',
      clientId: 'client-mine',
      clientSecretRef: 'arn:aws:secretsmanager:eu-west-2:000000000000:secret:mine',
      emailDomains: ['mine.example'],
    });
    await createIdentityProvider(db, {
      organisationId: otherOrganisationId,
      displayName: 'Theirs',
      issuerUrl: 'https://login.example.com',
      clientId: 'client-theirs',
      clientSecretRef: 'arn:aws:secretsmanager:eu-west-2:000000000000:secret:theirs',
      emailDomains: ['theirs.example'],
    });

    const providers = await withTenantTransaction(db, organisationId, (trx) =>
      findIdentityProvidersForOrganisation(trx),
    );

    expect(providers.map((provider) => provider.displayName)).toEqual(['Mine']);
  });

  it('updates a provider scoped to the current tenant', async () => {
    const created = await createIdentityProvider(db, {
      organisationId,
      displayName: 'To update',
      issuerUrl: 'https://login.example.com',
      clientId: 'client-update',
      clientSecretRef: 'arn:aws:secretsmanager:eu-west-2:000000000000:secret:update',
      emailDomains: ['update.example'],
    });

    const updated = await withTenantTransaction(db, organisationId, (trx) =>
      updateIdentityProvider(trx, created.providerId, { enabled: false }),
    );

    expect(updated?.enabled).toBe(false);
  });

  it('cannot update a provider belonging to a different tenant', async () => {
    const created = await createIdentityProvider(db, {
      organisationId: otherOrganisationId,
      displayName: 'Not mine to update',
      issuerUrl: 'https://login.example.com',
      clientId: 'client-cross-update',
      clientSecretRef: 'arn:aws:secretsmanager:eu-west-2:000000000000:secret:cross-update',
      emailDomains: ['cross-update.example'],
    });

    const result = await withTenantTransaction(db, organisationId, (trx) =>
      updateIdentityProvider(trx, created.providerId, { enabled: false }),
    );

    expect(result).toBeNull();
  });

  it('deletes a provider scoped to the current tenant', async () => {
    const created = await createIdentityProvider(db, {
      organisationId,
      displayName: 'To delete',
      issuerUrl: 'https://login.example.com',
      clientId: 'client-delete',
      clientSecretRef: 'arn:aws:secretsmanager:eu-west-2:000000000000:secret:delete',
      emailDomains: ['delete.example'],
    });

    const deleted = await withTenantTransaction(db, organisationId, (trx) =>
      deleteIdentityProvider(trx, created.providerId),
    );

    expect(deleted).toBe(true);
  });

  it('cannot delete a provider belonging to a different tenant', async () => {
    const created = await createIdentityProvider(db, {
      organisationId: otherOrganisationId,
      displayName: 'Not mine to delete',
      issuerUrl: 'https://login.example.com',
      clientId: 'client-cross-delete',
      clientSecretRef: 'arn:aws:secretsmanager:eu-west-2:000000000000:secret:cross-delete',
      emailDomains: ['cross-delete.example'],
    });

    const deleted = await withTenantTransaction(db, organisationId, (trx) =>
      deleteIdentityProvider(trx, created.providerId),
    );

    expect(deleted).toBe(false);
  });
});
