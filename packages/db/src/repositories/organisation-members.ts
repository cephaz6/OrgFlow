import { sql, type Selectable, type Transaction } from 'kysely';
import type {
  MemberStatus,
  OrganisationMember,
  OrganisationMemberSummary,
  OrganisationRole,
} from '@orgflow/types';

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

// `| undefined` on every member is required, not noise: the workspace runs
// exactOptionalPropertyTypes, so a caller spreading a parsed query object
// cannot pass these without it.
export interface MemberDirectoryFilter {
  // Free text across display name and email. Absent means no filter rather
  // than an empty search, which would otherwise match nothing.
  query?: string | undefined;
  status?: MemberStatus | undefined;
  role?: OrganisationRole | undefined;
}

// The administration directory (PRD.md §11.2's GET /members). Joins the
// person onto the membership, and joins a second time for the line
// manager's name so the screen can show "reports to" without a second
// round trip per row.
//
// Tenant scoping is RLS on organisation_members, exactly as everywhere else
// in this file. `users` has no organisation_id and no policy of its own, so
// it contributes no scoping: the membership side is what bounds the result,
// which is why the join is inner and starts from the membership.
export async function findMemberDirectoryForCurrentTenant(
  trx: Transaction<Database>,
  filter: MemberDirectoryFilter = {},
): Promise<OrganisationMemberSummary[]> {
  let query = trx
    .selectFrom('organisation_members')
    .innerJoin('users', 'users.user_id', 'organisation_members.user_id')
    .leftJoin(
      'users as line_managers',
      'line_managers.user_id',
      'organisation_members.line_manager_user_id',
    )
    .selectAll('organisation_members')
    .select([
      'users.email as email',
      'users.display_name as displayName',
      'line_managers.display_name as lineManagerName',
    ]);

  if (filter.status) {
    query = query.where('organisation_members.status', '=', filter.status);
  }

  if (filter.role) {
    // Same array-contains reasoning as findActiveMembersWithRole: Postgres
    // filters, and the value binds as a parameter rather than splicing.
    query = query.where(sql<boolean>`organisation_members.roles @> ARRAY[${filter.role}]::text[]`);
  }

  if (filter.query) {
    // Wrapped in its own group so it cannot widen the filters above: without
    // the callback the OR would associate across them and a role filter
    // would stop applying to name matches.
    const term = `%${filter.query}%`;
    query = query.where((eb) =>
      eb.or([eb('users.display_name', 'ilike', term), eb('users.email', 'ilike', term)]),
    );
  }

  const rows = await query.orderBy('users.display_name', 'asc').execute();

  return rows.map((row) => ({
    ...toDomain(row),
    email: row.email,
    displayName: row.displayName,
    lineManagerName: row.lineManagerName,
  }));
}

// Counts the owners who could still administer the organisation. The guard
// against removing or demoting the last one reads this, and it is here
// rather than in the route so that any future caller inherits it instead of
// having to remember it.
export async function countActiveOwnersForCurrentTenant(
  trx: Transaction<Database>,
): Promise<number> {
  const row = await trx
    .selectFrom('organisation_members')
    .select(sql<string>`count(*)`.as('total'))
    .where('status', '=', 'active')
    .where(sql<boolean>`roles @> ARRAY['owner']::text[]`)
    .executeTakeFirstOrThrow();

  return Number(row.total);
}

export interface UpdateOrganisationMemberInput {
  roles?: OrganisationRole[] | undefined;
  jobTitle?: string | null | undefined;
  department?: string | null | undefined;
  lineManagerUserId?: string | null | undefined;
  status?: MemberStatus | undefined;
}

// PRD.md §11.2's PATCH /members/:userId. Returns null when the user is not
// a member of the current tenant, which is what lets the route answer 404
// rather than 403 for a cross-tenant identifier (PRD.md §11.10, ADR-0015):
// RLS makes the row invisible, so the update matches nothing and there is
// no way to tell "not yours" from "does not exist".
export async function updateOrganisationMember(
  trx: Transaction<Database>,
  userId: string,
  input: UpdateOrganisationMemberInput,
): Promise<OrganisationMember | null> {
  const row = await trx
    .updateTable('organisation_members')
    .set({
      ...(input.roles !== undefined ? { roles: input.roles } : {}),
      ...(input.jobTitle !== undefined ? { job_title: input.jobTitle } : {}),
      ...(input.department !== undefined ? { department: input.department } : {}),
      ...(input.lineManagerUserId !== undefined
        ? { line_manager_user_id: input.lineManagerUserId }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      updated_at: new Date(),
    })
    .where('user_id', '=', userId)
    .returningAll()
    .executeTakeFirst();

  return row ? toDomain(row) : null;
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
