import { sql, type Kysely, type Selectable } from 'kysely';

import type { Database, IdentityProvidersTable } from '../schema.js';
import { generateId } from '../uuid.js';

export interface IdentityProviderRecord {
  providerId: string;
  organisationId: string;
  type: 'oidc';
  displayName: string;
  issuerUrl: string;
  clientId: string;
  clientSecretRef: string;
  emailDomains: string[];
  enabled: boolean;
}

function toDomain(row: Selectable<IdentityProvidersTable>): IdentityProviderRecord {
  return {
    providerId: row.provider_id,
    organisationId: row.organisation_id,
    type: row.type as 'oidc',
    displayName: row.display_name,
    issuerUrl: row.issuer_url,
    clientId: row.client_id,
    clientSecretRef: row.client_secret_ref,
    emailDomains: row.email_domains,
    enabled: row.enabled,
  };
}

// ADR-0011: deliberate, narrow exception, same reasoning as
// findMembershipsForUser. Runs on the plain (unscoped) connection. Filters
// by email domain only; never accepts an organisationId.
export async function findIdentityProviderByEmailDomain(
  db: Kysely<Database>,
  email: string,
): Promise<IdentityProviderRecord | null> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) {
    return null;
  }

  // Kysely's expression builder does not reliably serialise a plain JS
  // array as a Postgres array literal for the @> operand here (it reached
  // Postgres as the bare string, not `{domain}`); an explicit ARRAY[...]
  // cast with the domain as its own bind parameter is unambiguous.
  const row = await db
    .selectFrom('identity_providers')
    .selectAll()
    .where('enabled', '=', true)
    .where(sql<boolean>`email_domains @> ARRAY[${domain}]::text[]`)
    .executeTakeFirst();

  return row ? toDomain(row) : null;
}

export interface CreateIdentityProviderInput {
  organisationId: string;
  displayName: string;
  issuerUrl: string;
  clientId: string;
  clientSecretRef: string;
  emailDomains: string[];
}

export async function createIdentityProvider(
  db: Kysely<Database>,
  input: CreateIdentityProviderInput,
): Promise<IdentityProviderRecord> {
  const row = await db
    .insertInto('identity_providers')
    .values({
      provider_id: generateId(),
      organisation_id: input.organisationId,
      type: 'oidc',
      display_name: input.displayName,
      issuer_url: input.issuerUrl,
      client_id: input.clientId,
      client_secret_ref: input.clientSecretRef,
      email_domains: input.emailDomains,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toDomain(row);
}
