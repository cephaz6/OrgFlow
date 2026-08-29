import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
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
    isPlatformAdmin: row.is_platform_admin,
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

// No API path grants this (ADR-0026 defers that deliberately); the only
// caller today is the dev seed, so the seeded local identity behaves as
// the platform admin the operator described.
export async function ensurePlatformAdmin(
  db: Kysely<Database> | Transaction<Database>,
  userId: string,
): Promise<void> {
  await db
    .updateTable('users')
    .set({ is_platform_admin: true, updated_at: new Date() })
    .where('user_id', '=', userId)
    .where('is_platform_admin', '=', false)
    .execute();
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

// One query for a batch of ids, rather than a findUserById per row: a case
// comment thread's author list is exactly this shape (a handful of
// distinct ids repeated across many comments), and the caller only needs
// this to render a display name, not a full User per call site.
export async function findUsersByIds(db: Kysely<Database>, userIds: string[]): Promise<User[]> {
  if (userIds.length === 0) {
    return [];
  }

  const rows = await db.selectFrom('users').selectAll().where('user_id', 'in', userIds).execute();

  return rows.map(toDomain);
}

// Case-insensitive: identity providers do not agree on casing, and a
// delegate typing a colleague's email from memory should not have to match
// it exactly.
export async function findUserByEmail(db: Kysely<Database>, email: string): Promise<User | null> {
  const row = await db
    .selectFrom('users')
    .selectAll()
    .where(sql<boolean>`lower(email) = lower(${email})`)
    .executeTakeFirst();

  return row ? toDomain(row) : null;
}
