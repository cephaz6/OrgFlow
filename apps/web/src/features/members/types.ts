import type { MemberStatus, OrganisationRole } from '@orgflow/types';

// The shape GET /members returns (apps/api/src/routes/members.ts's toBody),
// which is narrower than the database's OrganisationMemberSummary: no
// organisation id, no membership id, nothing the screen does not render.
export interface MemberEntry {
  userId: string;
  email: string;
  displayName: string;
  roles: OrganisationRole[];
  jobTitle: string | null;
  department: string | null;
  lineManagerUserId: string | null;
  lineManagerName: string | null;
  status: MemberStatus;
  joinedAt: string;
}

export interface UpdateMemberInput {
  roles?: OrganisationRole[];
  jobTitle?: string | null;
  department?: string | null;
  lineManagerUserId?: string | null;
  status?: Exclude<MemberStatus, 'removed'>;
}

// Ordered from least to most capable, which is the order the role editor
// presents them in. `member` is deliberately absent from the editable set:
// every membership carries it as the floor, and offering it as a checkbox
// invites somebody to clear it and produce a member of nothing.
export const ASSIGNABLE_ROLES: readonly {
  role: OrganisationRole;
  label: string;
  description: string;
}[] = [
  {
    role: 'approver',
    label: 'Approver',
    description: 'Can act on tasks assigned to a role or group, not only to them by name.',
  },
  {
    role: 'processOwner',
    label: 'Process owner',
    description: 'Can build and publish processes, and see reports for the ones they own.',
  },
  {
    role: 'admin',
    label: 'Admin',
    description: 'Can manage members, groups and identity, and see every case.',
  },
  {
    role: 'owner',
    label: 'Owner',
    description: 'Everything an admin can do, plus organisation settings.',
  },
];
