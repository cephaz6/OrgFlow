import type { Kysely, Selectable } from 'kysely';
import type { Organisation, OrganisationStatus } from '@orgflow/types';

import type { Database, OrganisationsTable } from '../schema.js';
import { generateId } from '../uuid.js';

// organisations carries no organisation_id scoping column of its own (its
// primary key is one), so it has no RLS (PRD.md §2.6) and runs unscoped.

function toDomain(row: Selectable<OrganisationsTable>): Organisation {
  return {
    organisationId: row.organisation_id,
    name: row.name,
    slug: row.slug,
    status: row.status as OrganisationStatus,
    branding: row.branding,
    settings: row.settings,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function findOrganisationBySlug(
  db: Kysely<Database>,
  slug: string,
): Promise<Organisation | null> {
  const row = await db
    .selectFrom('organisations')
    .selectAll()
    .where('slug', '=', slug)
    .executeTakeFirst();

  return row ? toDomain(row) : null;
}

// No withTenantTransaction, and none is needed: organisations carries no
// organisation_id column of its own (the primary key is the tenant
// boundary), so it has no RLS policy to satisfy. Used by the invitation
// preview screen, which has to name the organisation before the caller has
// signed in to anything.
export async function findOrganisationById(
  db: Kysely<Database>,
  organisationId: string,
): Promise<Organisation | null> {
  const row = await db
    .selectFrom('organisations')
    .selectAll()
    .where('organisation_id', '=', organisationId)
    .executeTakeFirst();

  return row ? toDomain(row) : null;
}

export interface CreateOrganisationInput {
  name: string;
  slug: string;
  createdByUserId: string;
}

export async function createOrganisation(
  db: Kysely<Database>,
  input: CreateOrganisationInput,
): Promise<Organisation> {
  const row = await db
    .insertInto('organisations')
    .values({
      organisation_id: generateId(),
      name: input.name,
      slug: input.slug,
      created_by_user_id: input.createdByUserId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toDomain(row);
}

export interface UpdateOrganisationInput {
  name?: string | undefined;
  branding?: Record<string, unknown> | undefined;
  settings?: Record<string, unknown> | undefined;
}

// Unscoped like every other function in this file: organisations has no
// organisation_id column of its own to scope by. The caller
// (PATCH /organisations/current) is what confines this to the requester's
// own organisation, by only ever passing session.organisationId.
export async function updateOrganisation(
  db: Kysely<Database>,
  organisationId: string,
  input: UpdateOrganisationInput,
): Promise<Organisation | null> {
  const row = await db
    .updateTable('organisations')
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.branding !== undefined ? { branding: input.branding } : {}),
      ...(input.settings !== undefined ? { settings: input.settings } : {}),
      updated_at: new Date(),
    })
    .where('organisation_id', '=', organisationId)
    .returningAll()
    .executeTakeFirst();

  return row ? toDomain(row) : null;
}
