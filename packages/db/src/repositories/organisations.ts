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
