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

// A member as the administration screens need to show one: the membership
// facts above, plus the identity behind them. `users` carries no
// organisation_id and is therefore outside Row-Level Security, so the join
// that produces this is bounded by the membership side alone. Kept separate
// from OrganisationMember rather than widening it, because every existing
// caller (the engine's directory lookups, notification recipients) wants
// the membership without paying for a join it does not read.
export interface OrganisationMemberSummary extends OrganisationMember {
  email: string;
  displayName: string;
  lineManagerName: string | null;
}
