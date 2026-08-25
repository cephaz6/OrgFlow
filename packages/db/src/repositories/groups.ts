import type { Transaction } from 'kysely';

import type { Database } from '../schema.js';
import { generateId } from '../uuid.js';

// ADR-0014: a definition document names a group by its stable key, but
// case_tasks stores a group id, and the engine performs no I/O so it cannot
// make that lookup itself. EvaluationContext.directory.groupIdsByKey is how
// the caller supplies the mapping; this is what builds it.
//
// The whole organisation's groups in one query rather than one lookup per
// referenced key: a definition may reference several, the row count per
// tenant is small, and the alternative is a query inside the engine's
// assignment path, which is exactly what the directory field exists to
// avoid.
export async function findGroupIdsByKeyForCurrentTenant(
  trx: Transaction<Database>,
): Promise<Record<string, string>> {
  const rows = await trx.selectFrom('groups').select(['key', 'group_id']).execute();

  return Object.fromEntries(rows.map((row) => [row.key, row.group_id]));
}

export interface Group {
  groupId: string;
  key: string;
  name: string;
  description: string | null;
}

// Every group in the current tenant, for the owning-group select on a
// process definition (ADR-0027). Ordered by name since this is a picklist,
// not an audit trail.
export async function findGroupsForOrganisation(trx: Transaction<Database>): Promise<Group[]> {
  const rows = await trx
    .selectFrom('groups')
    .select(['group_id', 'key', 'name', 'description'])
    .orderBy('name', 'asc')
    .execute();

  return rows.map((row) => ({
    groupId: row.group_id,
    key: row.key,
    name: row.name,
    description: row.description,
  }));
}

export interface EnsureGroupInput {
  organisationId: string;
  key: string;
  name: string;
  description?: string | null;
}

// Idempotent on (organisation_id, key), which ADR-0014's unique constraint
// makes the natural conflict target. Used by the seeded development data,
// which runs on every dev-login.
export async function ensureGroup(
  trx: Transaction<Database>,
  input: EnsureGroupInput,
): Promise<string> {
  const existing = await trx
    .selectFrom('groups')
    .select('group_id')
    .where('key', '=', input.key)
    .executeTakeFirst();

  if (existing) {
    return existing.group_id;
  }

  const row = await trx
    .insertInto('groups')
    .values({
      group_id: generateId(),
      organisation_id: input.organisationId,
      key: input.key,
      name: input.name,
      description: input.description ?? null,
    })
    .returning('group_id')
    .executeTakeFirstOrThrow();

  return row.group_id;
}

export async function ensureGroupMember(
  trx: Transaction<Database>,
  input: { organisationId: string; groupId: string; userId: string },
): Promise<void> {
  await trx
    .insertInto('group_members')
    .values({
      group_member_id: generateId(),
      organisation_id: input.organisationId,
      group_id: input.groupId,
      user_id: input.userId,
    })
    // UNIQUE (group_id, user_id) from the identity-and-tenancy migration.
    .onConflict((oc) => oc.columns(['group_id', 'user_id']).doNothing())
    .execute();
}

// Who is in a group: the recipients of a claimable-task notification for a
// group-assigned step (PRD.md §14.1, `taskClaimable`).
export async function findGroupMemberUserIds(
  trx: Transaction<Database>,
  groupId: string,
): Promise<string[]> {
  const rows = await trx
    .selectFrom('group_members')
    .select('user_id')
    .where('group_id', '=', groupId)
    .execute();

  return rows.map((row) => row.user_id);
}

// The claimable pool for a group-assigned task: who may act on it.
export async function findGroupIdsForUser(
  trx: Transaction<Database>,
  userId: string,
): Promise<string[]> {
  const rows = await trx
    .selectFrom('group_members')
    .select('group_id')
    .where('user_id', '=', userId)
    .execute();

  return rows.map((row) => row.group_id);
}
