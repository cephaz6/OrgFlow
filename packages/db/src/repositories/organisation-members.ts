import type { Selectable, Transaction } from 'kysely';
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
