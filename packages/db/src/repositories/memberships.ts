import type { Kysely, Selectable } from 'kysely';
import type { MemberStatus, OrganisationMember, OrganisationRole } from '@orgflow/types';

import type { Database, OrganisationMembersTable } from '../schema.js';

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

// ADR-0011: deliberate, narrow exception. Runs on the plain (unscoped)
// connection, never withTenantTransaction, because resolving which
// organisations a user belongs to is inherently cross-tenant and happens
// before any single organisation context exists. Filters by user_id only;
// never accepts an organisationId. Not a general-purpose escape hatch, and
// must stay the only caller of the unscoped connection outside migrations.
export async function findMembershipsForUser(
  db: Kysely<Database>,
  userId: string,
): Promise<OrganisationMember[]> {
  const rows = await db
    .selectFrom('organisation_members')
    .selectAll()
    .where('user_id', '=', userId)
    .where('status', '=', 'active')
    .execute();

  return rows.map(toDomain);
}
