import type { IsoDateTimeString, Uuid } from './common.js';

export type OrganisationRole = 'member' | 'approver' | 'processOwner' | 'admin' | 'owner';

export type MemberStatus = 'active' | 'suspended' | 'removed';

export interface OrganisationMember {
  organisationMemberId: Uuid;
  organisationId: Uuid;
  userId: Uuid;
  roles: OrganisationRole[];
  jobTitle: string | null;
  department: string | null;
  lineManagerUserId: Uuid | null;
  status: MemberStatus;
  joinedAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}
