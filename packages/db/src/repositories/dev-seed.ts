import type { Kysely } from 'kysely';
import type { OrganisationMember, User } from '@orgflow/types';

import type { Database } from '../schema.js';
import { generateId } from '../uuid.js';
import { createOrganisation, findOrganisationBySlug } from './organisations.js';
import { createUserWithIdentity, findUserByIdentity } from './users.js';

// Only ever invoked from the /auth/dev-login route, itself guarded to fail
// closed outside ORGFLOW_ENV=local (GOV-STANDARDS.md §6.2). Idempotent:
// safe to call on every dev-login request.
const DEV_ISSUER = 'urn:orgflow:dev';
const DEV_SUBJECT = 'dev-user';
const DEV_ORG_SLUG = 'orgflow-dev';

export interface DevSeedResult {
  user: User;
  membership: OrganisationMember;
}

export async function ensureDevUser(db: Kysely<Database>): Promise<DevSeedResult> {
  const existing = await findUserByIdentity(db, DEV_ISSUER, DEV_SUBJECT);
  const user =
    existing?.user ??
    (await createUserWithIdentity(db, {
      email: 'dev@orgflow.local',
      displayName: 'Local Dev User',
      issuer: DEV_ISSUER,
      subject: DEV_SUBJECT,
    }));

  let organisation = await findOrganisationBySlug(db, DEV_ORG_SLUG);
  organisation ??= await createOrganisation(db, {
    name: 'OrgFlow Dev',
    slug: DEV_ORG_SLUG,
    createdByUserId: user.userId,
  });

  const membershipRow = await db
    .selectFrom('organisation_members')
    .selectAll()
    .where('organisation_id', '=', organisation.organisationId)
    .where('user_id', '=', user.userId)
    .executeTakeFirst();

  const membership =
    membershipRow ??
    (await db
      .insertInto('organisation_members')
      .values({
        organisation_member_id: generateId(),
        organisation_id: organisation.organisationId,
        user_id: user.userId,
        roles: ['owner', 'admin', 'processOwner', 'approver', 'member'],
      })
      .returningAll()
      .executeTakeFirstOrThrow());

  return {
    user,
    membership: {
      organisationMemberId: membership.organisation_member_id,
      organisationId: membership.organisation_id,
      userId: membership.user_id,
      roles: membership.roles as OrganisationMember['roles'],
      jobTitle: membership.job_title,
      department: membership.department,
      lineManagerUserId: membership.line_manager_user_id,
      status: membership.status as OrganisationMember['status'],
      joinedAt:
        membership.joined_at instanceof Date
          ? membership.joined_at.toISOString()
          : new Date(membership.joined_at).toISOString(),
      updatedAt:
        membership.updated_at instanceof Date
          ? membership.updated_at.toISOString()
          : new Date(membership.updated_at).toISOString(),
    },
  };
}
