import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';

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

// Everything below runs inside withTenantTransaction, unlike the two
// functions above: those two are ADR-0011's deliberate, narrow exceptions
// for the pre-tenant-context steps of the login flow itself. Once a session
// exists and an organisation is known, admin management of that
// organisation's own providers goes through ordinary RLS scoping like every
// other repository function in the codebase.

export async function findIdentityProvidersForOrganisation(
  trx: Transaction<Database>,
): Promise<IdentityProviderRecord[]> {
  const rows = await trx
    .selectFrom('identity_providers')
    .selectAll()
    .orderBy('display_name', 'asc')
    .execute();

  return rows.map(toDomain);
}

// Every field optional, but at least one present: matches the same
// caller-mistake reasoning as UpdateOrganisationMemberInput's patch schema.
export interface UpdateIdentityProviderInput {
  displayName?: string | undefined;
  issuerUrl?: string | undefined;
  clientId?: string | undefined;
  clientSecretRef?: string | undefined;
  emailDomains?: string[] | undefined;
  enabled?: boolean | undefined;
}

export async function updateIdentityProvider(
  trx: Transaction<Database>,
  providerId: string,
  input: UpdateIdentityProviderInput,
): Promise<IdentityProviderRecord | null> {
  const row = await trx
    .updateTable('identity_providers')
    .set({
      ...(input.displayName !== undefined ? { display_name: input.displayName } : {}),
      ...(input.issuerUrl !== undefined ? { issuer_url: input.issuerUrl } : {}),
      ...(input.clientId !== undefined ? { client_id: input.clientId } : {}),
      ...(input.clientSecretRef !== undefined ? { client_secret_ref: input.clientSecretRef } : {}),
      ...(input.emailDomains !== undefined ? { email_domains: input.emailDomains } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      updated_at: new Date(),
    })
    .where('provider_id', '=', providerId)
    .returningAll()
    .executeTakeFirst();

  return row ? toDomain(row) : null;
}

export async function deleteIdentityProvider(
  trx: Transaction<Database>,
  providerId: string,
): Promise<boolean> {
  const result = await trx
    .deleteFrom('identity_providers')
    .where('provider_id', '=', providerId)
    .executeTakeFirst();

  return result.numDeletedRows > 0n;
}
