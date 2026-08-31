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

// Real creation, for the groups management screen: unlike ensureGroup
// below, this never treats an existing key as success. The caller (the
// route) has already allocated a key it believes is free; the unique
// constraint on (organisation_id, key) is what actually decides, and a
// 23505 there is a real, if rare, race for the route to handle, not
// something this function papers over.
export async function createGroup(
  trx: Transaction<Database>,
  input: EnsureGroupInput,
): Promise<Group> {
  const row = await trx
    .insertInto('groups')
    .values({
      group_id: generateId(),
      organisation_id: input.organisationId,
      key: input.key,
      name: input.name,
      description: input.description ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return { groupId: row.group_id, key: row.key, name: row.name, description: row.description };
}

export interface UpdateGroupInput {
  name?: string | undefined;
  description?: string | null | undefined;
}

// Name and description only: ADR-0014's whole point is that `key` is the
// stable identifier a pinned definition document resolves against, so it
// is never offered as something this can change.
export async function updateGroup(
  trx: Transaction<Database>,
  groupId: string,
  input: UpdateGroupInput,
): Promise<Group | null> {
  const row = await trx
    .updateTable('groups')
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    })
    .where('group_id', '=', groupId)
    .returningAll()
    .executeTakeFirst();

  return row
    ? { groupId: row.group_id, key: row.key, name: row.name, description: row.description }
    : null;
}

// group_members cascades on the group's own deletion, so an otherwise
// unreferenced group with members still deletes cleanly. A group named by
// a process definition's owning_group_id or a case_task's
// assignee_group_id does not: both reference groups with the default
// RESTRICT, and the route turns that 23503 into a clear 409 rather than
// letting a raw constraint violation surface.
export async function deleteGroup(trx: Transaction<Database>, groupId: string): Promise<boolean> {
  const result = await trx.deleteFrom('groups').where('group_id', '=', groupId).executeTakeFirst();

  return result.numDeletedRows > 0n;
}

export interface GroupMember {
  userId: string;
  displayName: string;
  email: string;
}

// Who is in a group, for the management screen's membership list: unlike
// findGroupMemberUserIds (the engine's own claimable-pool lookup, which
// only ever needs the ids), this joins through to the identity a person
// actually recognises.
export async function findGroupMembersForGroup(
  trx: Transaction<Database>,
  groupId: string,
): Promise<GroupMember[]> {
  const rows = await trx
    .selectFrom('group_members')
    .innerJoin('users', 'users.user_id', 'group_members.user_id')
    .select(['users.user_id', 'users.display_name', 'users.email'])
    .where('group_members.group_id', '=', groupId)
    .orderBy('users.display_name', 'asc')
    .execute();

  return rows.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    email: row.email,
  }));
}

// Scoped to the group, not just the (group_id, user_id) pair: a caller
// that already knows the row cannot exist outside this group has no way to
// remove a member of a different one by accident, and the route's own 404
// on a zero-row result already covers "never was a member" and "wrong
// group" identically, matching PRD.md §11.10's cross-tenant convention for
// the same reason.
export async function removeGroupMember(
  trx: Transaction<Database>,
  groupId: string,
  userId: string,
): Promise<boolean> {
  const result = await trx
    .deleteFrom('group_members')
    .where('group_id', '=', groupId)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  return result.numDeletedRows > 0n;
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
