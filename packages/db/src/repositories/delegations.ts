import type { Delegation } from '@orgflow/types';
import type { Selectable, Transaction } from 'kysely';

import type { Database, DelegationsTable } from '../schema.js';
import { generateId } from '../uuid.js';

function toDomain(row: Selectable<DelegationsTable>): Delegation {
  return {
    delegationId: row.delegation_id,
    organisationId: row.organisation_id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
  };
}

export interface CreateDelegationInput {
  organisationId: string;
  fromUserId: string;
  toUserId: string;
  startsAt: string;
  endsAt: string;
  reason?: string | null;
}

export async function createDelegation(
  trx: Transaction<Database>,
  input: CreateDelegationInput,
): Promise<Delegation> {
  const row = await trx
    .insertInto('delegations')
    .values({
      delegation_id: generateId(),
      organisation_id: input.organisationId,
      from_user_id: input.fromUserId,
      to_user_id: input.toUserId,
      starts_at: new Date(input.startsAt),
      ends_at: new Date(input.endsAt),
      reason: input.reason ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toDomain(row);
}

// PRD.md §7: "If the resolved user has an active delegation covering now."
// Returned as a map rather than a list, since this is built once per
// evaluation and handed straight into EvaluationContext.directory
// .activeDelegateByUserId, which is exactly this shape.
export async function findActiveDelegateByUserId(
  trx: Transaction<Database>,
  now: Date,
): Promise<Record<string, string>> {
  const rows = await trx
    .selectFrom('delegations')
    .select(['from_user_id', 'to_user_id'])
    .where('starts_at', '<=', now)
    .where('ends_at', '>', now)
    .execute();

  const byUserId: Record<string, string> = {};
  for (const row of rows) {
    byUserId[row.from_user_id] = row.to_user_id;
  }
  return byUserId;
}

// Every delegation a user is party to, past or present, either side: what
// "My delegations" (apps/web) lists.
export async function findDelegationsForUser(
  trx: Transaction<Database>,
  userId: string,
): Promise<Delegation[]> {
  const rows = await trx
    .selectFrom('delegations')
    .selectAll()
    .where((eb) => eb.or([eb('from_user_id', '=', userId), eb('to_user_id', '=', userId)]))
    .orderBy('starts_at', 'desc')
    .execute();

  return rows.map(toDomain);
}

export async function findDelegationById(
  trx: Transaction<Database>,
  delegationId: string,
): Promise<Delegation | null> {
  const row = await trx
    .selectFrom('delegations')
    .selectAll()
    .where('delegation_id', '=', delegationId)
    .executeTakeFirst();

  return row ? toDomain(row) : null;
}

// No status column: a delegation is a fact about a time range, not a
// lifecycle with a cancelled state, and PRD.md's own schema (§2.5) has none
// either. "Cancelling" one early is deleting it: nothing else in the
// schema references a delegation by id (case_tasks.delegated_from_user_id
// is a user id, recorded at resolution time, not a foreign key to this
// table), so nothing is left dangling.
export async function deleteDelegation(
  trx: Transaction<Database>,
  delegationId: string,
): Promise<void> {
  await trx.deleteFrom('delegations').where('delegation_id', '=', delegationId).execute();
}
