import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb } from './connection.js';
import {
  findOrganisationMembersForCurrentTenant,
  insertOrganisationMember,
} from './repositories/organisation-members.js';
import type { Database } from './schema.js';
import { withTenantTransaction } from './tenant-transaction.js';
import { generateId } from './uuid.js';

// Local Docker Compose credentials, not a secret (ADR-0007). Requires
// `docker compose up -d postgres` and the migrations applied.
const CONNECTION_STRING = 'postgres://orgflow:orgflow@localhost:5432/orgflow';

describe('cross-tenant isolation on organisation_members', () => {
  let db: Kysely<Database>;
  let organisationAId: string;
  let organisationBId: string;
  let userId: string;

  beforeAll(async () => {
    db = createDb({ connectionString: CONNECTION_STRING });

    organisationAId = generateId();
    organisationBId = generateId();
    userId = generateId();

    await db
      .insertInto('organisations')
      .values([
        {
          organisation_id: organisationAId,
          name: 'RLS test tenant A',
          slug: `rls-test-a-${organisationAId}`,
          created_by_user_id: userId,
        },
        {
          organisation_id: organisationBId,
          name: 'RLS test tenant B',
          slug: `rls-test-b-${organisationBId}`,
          created_by_user_id: userId,
        },
      ])
      .execute();

    await db
      .insertInto('users')
      .values({
        user_id: userId,
        email: `rls-test-${userId}@example.invalid`,
        display_name: 'RLS test user',
      })
      .execute();

    await withTenantTransaction(db, organisationAId, async (trx) => {
      await insertOrganisationMember(trx, { organisationId: organisationAId, userId });
    });
  });

  afterAll(async () => {
    await db
      .deleteFrom('organisations')
      .where('organisation_id', 'in', [organisationAId, organisationBId])
      .execute();
    await db.deleteFrom('users').where('user_id', '=', userId).execute();
    await db.destroy();
  });

  it('hides organisation A rows from a session scoped to organisation B', async () => {
    const visibleToB = await withTenantTransaction(db, organisationBId, (trx) =>
      findOrganisationMembersForCurrentTenant(trx),
    );

    expect(visibleToB).toHaveLength(0);
  });

  it('returns organisation A rows to a session scoped to organisation A', async () => {
    const visibleToA = await withTenantTransaction(db, organisationAId, (trx) =>
      findOrganisationMembersForCurrentTenant(trx),
    );

    expect(visibleToA).toHaveLength(1);
    expect(visibleToA[0]?.userId).toBe(userId);
    expect(visibleToA[0]?.organisationId).toBe(organisationAId);
  });

  it('rejects inserting a row for organisation B while scoped to organisation A', async () => {
    await expect(
      withTenantTransaction(db, organisationAId, (trx) =>
        insertOrganisationMember(trx, { organisationId: organisationBId, userId }),
      ),
    ).rejects.toThrow();
  });
});
