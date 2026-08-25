import type { OrganisationRole } from '@orgflow/types';

// GET /invitations's shape (apps/api/src/routes/invitations.ts's toBody).
export interface InvitationEntry {
  invitationId: string;
  email: string;
  roles: OrganisationRole[];
  invitedByUserId: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

// GET /invitations/:token's shape: narrower than InvitationEntry, since it
// is served to somebody who has proven nothing yet (ADR-0025).
export interface InvitationPreview {
  organisationName: string;
  invitedByDisplayName: string;
  email: string;
  roles: OrganisationRole[];
  expiresAt: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
}

export interface CreateInvitationInput {
  email: string;
  roles: OrganisationRole[];
}

// Duplicated from features/members/types.ts rather than imported: that
// module's barrel also re-exports a Server Component-only fetch (it reads
// next/headers), and invite-form.tsx is a Client Component. Pulling
// anything through that barrel from here bundles the server-only code into
// the client and fails the build. Five entries, unlikely to drift, the same
// trade-off apps/api/src/routes/members.ts's and
// apps/api/src/routes/invitations.ts's own ROLES consts already accept.
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
