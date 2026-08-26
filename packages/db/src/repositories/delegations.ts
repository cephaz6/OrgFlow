import type { Delegation } from '@orgflow/types';
import { sql, type Selectable, type Transaction } from 'kysely';

import { clampPageSize, decodeCompositeCursor, encodeCompositeCursor } from '../pagination.js';
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

export interface FindDelegationsForUserFilter {
  // Free text over the counterpart's name or email, i.e. whichever side of
  // the delegation is not userId. Absent means no filter rather than an
  // empty search, which would otherwise match nothing.
  query?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface DelegationPage {
  delegations: Delegation[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface DelegationCursor extends Record<string, string> {
  startsAt: string;
  id: string;
}

// Every delegation a user is party to, past or present, either side: what
// "My delegations" (apps/web) lists. Both users are always joined (not
// only when searching): Kysely fixes a query builder's type at the point
// it is first assigned, so branching between a joined and unjoined query
// under one `let` does not type-check. The join is a fixed, cheap cost
// for a personal list that is never more than a handful of rows.
export async function findDelegationsForUser(
  trx: Transaction<Database>,
  userId: string,
  filter: FindDelegationsForUserFilter = {},
): Promise<DelegationPage> {
  let query = trx
    .selectFrom('delegations')
    .innerJoin('users as from_user', 'from_user.user_id', 'delegations.from_user_id')
    .innerJoin('users as to_user', 'to_user.user_id', 'delegations.to_user_id')
    .selectAll('delegations')
    .where((eb) =>
      eb.or([
        eb('delegations.from_user_id', '=', userId),
        eb('delegations.to_user_id', '=', userId),
      ]),
    );

  if (filter.query) {
    // The counterpart is whichever side is not userId, so this matches
    // whichever joined user applies per row: when userId is the sender,
    // the counterpart is the recipient, and vice versa.
    const term = `%${filter.query}%`;
    query = query.where((eb) =>
      eb.or([
        eb.and([
          eb('delegations.from_user_id', '=', userId),
          eb.or([eb('to_user.display_name', 'ilike', term), eb('to_user.email', 'ilike', term)]),
        ]),
        eb.and([
          eb('delegations.to_user_id', '=', userId),
          eb.or([
            eb('from_user.display_name', 'ilike', term),
            eb('from_user.email', 'ilike', term),
          ]),
        ]),
      ]),
    );
  }

  const cursor = filter.cursor
    ? decodeCompositeCursor<DelegationCursor>(filter.cursor, ['startsAt', 'id'])
    : null;
  if (cursor) {
    query = query.where(
      sql<boolean>`(delegations.starts_at, delegations.delegation_id) < (${cursor.startsAt}::timestamptz, ${cursor.id})`,
    );
  }

  const limit = clampPageSize(filter.limit);

  const rows = await query
    .orderBy('delegations.starts_at', 'desc')
    .orderBy('delegations.delegation_id', 'desc')
    .limit(limit + 1)
    .execute();

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    delegations: page.map(toDomain),
    nextCursor:
      hasMore && last
        ? encodeCompositeCursor<DelegationCursor>({
            startsAt: last.starts_at.toISOString(),
            id: last.delegation_id,
          })
        : null,
    hasMore,
  };
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
