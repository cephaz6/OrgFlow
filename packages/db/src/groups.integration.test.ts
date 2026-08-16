import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb } from './connection.js';
import {
  ensureGroup,
  ensureGroupMember,
  findGroupIdsByKeyForCurrentTenant,
  findGroupIdsForUser,
} from './repositories/groups.js';
import { createOrganisation } from './repositories/organisations.js';
import { createUserWithIdentity } from './repositories/users.js';
import type { Database } from './schema.js';
import { withTenantTransaction } from './tenant-transaction.js';
import { generateId } from './uuid.js';

async function seedTenant(db: Kysely<Database>, label: string) {
  const user = await createUserWithIdentity(db, {
    email: `${label}-${generateId()}@example.invalid`,
    displayName: `${label} user`,
    issuer: 'urn:orgflow:test',
    subject: `${label}-${generateId()}`,
  });

  const organisation = await createOrganisation(db, {
    name: `${label} tenant`,
    slug: `${label}-${generateId()}`,
    createdByUserId: user.userId,
  });

  return { user, organisation };
}

describe('group keys (ADR-0014)', () => {
  let db: Kysely<Database>;
  let tenantA: Awaited<ReturnType<typeof seedTenant>>;
  let tenantB: Awaited<ReturnType<typeof seedTenant>>;

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    tenantA = await seedTenant(db, 'groups-a');
    tenantB = await seedTenant(db, 'groups-b');
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('creates a group once and returns the same id on a second call', async () => {
    const first = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      ensureGroup(trx, {
        organisationId: tenantA.organisation.organisationId,
        key: 'itSupport',
        name: 'IT Support',
      }),
    );

    const second = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      ensureGroup(trx, {
        organisationId: tenantA.organisation.organisationId,
        key: 'itSupport',
        name: 'IT Support',
      }),
    );

    expect(second).toBe(first);
  });

  it('builds the directory the engine resolves groupKey against', async () => {
    const directory = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      findGroupIdsByKeyForCurrentTenant(trx),
    );

    expect(directory.itSupport).toBeTruthy();
  });

  it('keeps the key stable when the display name changes', async () => {
    // The whole reason ADR-0014 adds a key: a pinned definition version
    // references groupKey forever, so a rename must not break it.
    const groupId = await withTenantTransaction(
      db,
      tenantA.organisation.organisationId,
      async (trx) => {
        const id = await ensureGroup(trx, {
          organisationId: tenantA.organisation.organisationId,
          key: 'itSupport',
          name: 'IT Support',
        });
        await trx
          .updateTable('groups')
          .set({ name: 'Technology Services' })
          .where('group_id', '=', id)
          .execute();
        return id;
      },
    );

    const directory = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      findGroupIdsByKeyForCurrentTenant(trx),
    );

    expect(directory.itSupport).toBe(groupId);
  });

  it('does not leak one tenant’s groups into another tenant’s directory', async () => {
    await withTenantTransaction(db, tenantB.organisation.organisationId, (trx) =>
      ensureGroup(trx, {
        organisationId: tenantB.organisation.organisationId,
        key: 'financeTeam',
        name: 'Finance Team',
      }),
    );

    const directoryForA = await withTenantTransaction(
      db,
      tenantA.organisation.organisationId,
      (trx) => findGroupIdsByKeyForCurrentTenant(trx),
    );

    expect(directoryForA.financeTeam).toBeUndefined();

    // Both tenants may hold the same key, since uniqueness is scoped to
    // (organisation_id, key), and each resolves to its own group.
    const bothKeyed = await withTenantTransaction(db, tenantB.organisation.organisationId, (trx) =>
      ensureGroup(trx, {
        organisationId: tenantB.organisation.organisationId,
        key: 'itSupport',
        name: 'IT Support',
      }),
    );

    expect(bothKeyed).not.toBe(directoryForA.itSupport);
  });

  it('adds a group member idempotently and lists the groups a user belongs to', async () => {
    const groupId = await withTenantTransaction(
      db,
      tenantA.organisation.organisationId,
      async (trx) => {
        const id = await ensureGroup(trx, {
          organisationId: tenantA.organisation.organisationId,
          key: 'itSupport',
          name: 'IT Support',
        });
        await ensureGroupMember(trx, {
          organisationId: tenantA.organisation.organisationId,
          groupId: id,
          userId: tenantA.user.userId,
        });
        await ensureGroupMember(trx, {
          organisationId: tenantA.organisation.organisationId,
          groupId: id,
          userId: tenantA.user.userId,
        });
        return id;
      },
    );

    const groupIds = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      findGroupIdsForUser(trx, tenantA.user.userId),
    );

    expect(groupIds).toEqual([groupId]);
  });
});
