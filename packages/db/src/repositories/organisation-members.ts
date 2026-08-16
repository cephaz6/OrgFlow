import { sql, type Selectable, type Transaction } from 'kysely';
import type { MemberStatus, OrganisationMember, OrganisationRole } from '@orgflow/types';

import type { Database, OrganisationMembersTable } from '../schema.js';
import { generateId } from '../uuid.js';

// The one mapping boundary (CLAUDE.md §4): snake_case DB rows in, camelCase
// @orgflow/types domain objects out. Nothing outside packages/db sees a
// Kysely row shape.
function toDomain(row: Selectable<OrganisationMembersTable>): OrganisationMember {
  return {
    organisationMemberId: row.organisation_member_id,
    organisationId: row.organisation_id,
    userId: row.user_id,
    roles: row.roles as OrganisationRole[],
    jobTitle: row.job_title,
    department: row.department,
    lineManagerUserId: row.line_manager_user_id,
    status: row.status as MemberStatus,
    joinedAt: row.joined_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface InsertOrganisationMemberInput {
  organisationId: string;
  userId: string;
  roles?: OrganisationRole[];
}

export async function insertOrganisationMember(
  trx: Transaction<Database>,
  input: InsertOrganisationMemberInput,
): Promise<OrganisationMember> {
  const row = await trx
    .insertInto('organisation_members')
    .values({
      organisation_member_id: generateId(),
      organisation_id: input.organisationId,
      user_id: input.userId,
      ...(input.roles ? { roles: input.roles } : {}),
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toDomain(row);
}

export async function findOrganisationMembersForCurrentTenant(
  trx: Transaction<Database>,
): Promise<OrganisationMember[]> {
  const rows = await trx.selectFrom('organisation_members').selectAll().execute();
  return rows.map(toDomain);
}

// The submitter's directory facts, which the engine cannot look up itself:
// EvaluationContext carries department, roles and lineManagerUserId, and
// all three come from here. Tenant-scoped by RLS like every other query in
// this file, so a member of another organisation reads as absent.
export async function findOrganisationMemberByUserId(
  trx: Transaction<Database>,
  userId: string,
): Promise<OrganisationMember | null> {
  const row = await trx
    .selectFrom('organisation_members')
    .selectAll()
    .where('user_id', '=', userId)
    .executeTakeFirst();

  return row ? toDomain(row) : null;
}

// Active members holding a role, which is the recipient list for a
// role-assigned task's claimable notification (PRD.md §14.1).
export async function findActiveMembersWithRole(
  trx: Transaction<Database>,
  role: string,
): Promise<OrganisationMember[]> {
  const rows = await trx
    .selectFrom('organisation_members')
    .selectAll()
    .where('status', '=', 'active')
    // roles is a TEXT[]; the array-contains operator lets Postgres do the
    // filtering rather than pulling every member back to filter in memory.
    // The role reaches here from a tenant-authored definition document, so
    // it is interpolated as a bind parameter, never inlined: Kysely's sql
    // template parameterises `${role}` but `sql.lit(role)` would splice the
    // string straight into the statement.
    .where(sql<boolean>`roles @> ARRAY[${role}]::text[]`)
    .execute();

  return rows.map(toDomain);
}

export async function setLineManager(
  trx: Transaction<Database>,
  userId: string,
  lineManagerUserId: string | null,
): Promise<void> {
  await trx
    .updateTable('organisation_members')
    .set({ line_manager_user_id: lineManagerUserId, updated_at: new Date() })
    .where('user_id', '=', userId)
    .execute();
}
