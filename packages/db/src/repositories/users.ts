import type { Kysely, Selectable, Transaction } from 'kysely';
import type { User, UserStatus } from '@orgflow/types';

import type { Database, UsersTable } from '../schema.js';
import { generateId } from '../uuid.js';

// users and user_identities carry no organisation_id and have no RLS
// (PRD.md §2.1); they are global, so these run on the plain connection or
// inside an ordinary (non-tenant) transaction, never withTenantTransaction.

function toDomain(row: Selectable<UsersTable>): User {
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    status: row.status as UserStatus,
    lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface FindUserByIdentityResult {
  user: User;
}

export async function findUserByIdentity(
  db: Kysely<Database>,
  issuer: string,
  subject: string,
): Promise<FindUserByIdentityResult | null> {
  const row = await db
    .selectFrom('user_identities')
    .innerJoin('users', 'users.user_id', 'user_identities.user_id')
    .selectAll('users')
    .where('user_identities.issuer', '=', issuer)
    .where('user_identities.subject', '=', subject)
    .executeTakeFirst();

  return row ? { user: toDomain(row) } : null;
}

export interface CreateUserWithIdentityInput {
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  issuer: string;
  subject: string;
  providerId?: string | null;
}

// Runs both inserts in one transaction for atomicity; still not tenant-scoped.
export async function createUserWithIdentity(
  db: Kysely<Database>,
  input: CreateUserWithIdentityInput,
): Promise<User> {
  return db.transaction().execute(async (trx) => {
    const userRow = await trx
      .insertInto('users')
      .values({
        user_id: generateId(),
        email: input.email,
        display_name: input.displayName,
        avatar_url: input.avatarUrl ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await trx
      .insertInto('user_identities')
      .values({
        user_identity_id: generateId(),
        user_id: userRow.user_id,
        provider_id: input.providerId ?? null,
        issuer: input.issuer,
        subject: input.subject,
      })
      .execute();

    return toDomain(userRow);
  });
}

export async function touchLastLogin(
  db: Kysely<Database> | Transaction<Database>,
  userId: string,
): Promise<void> {
  await db
    .updateTable('users')
    .set({ last_login_at: new Date(), updated_at: new Date() })
    .where('user_id', '=', userId)
    .execute();
}

export async function findUserById(db: Kysely<Database>, userId: string): Promise<User | null> {
  const row = await db
    .selectFrom('users')
    .selectAll()
    .where('user_id', '=', userId)
    .executeTakeFirst();

  return row ? toDomain(row) : null;
}
