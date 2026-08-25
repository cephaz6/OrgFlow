import type { IsoDateTimeString, Uuid } from './common.js';
import type { OrganisationRole } from './membership.js';

export interface Invitation {
  invitationId: Uuid;
  organisationId: Uuid;
  email: string;
  roles: OrganisationRole[];
  invitedByUserId: Uuid;
  expiresAt: IsoDateTimeString;
  acceptedAt: IsoDateTimeString | null;
  revokedAt: IsoDateTimeString | null;
  createdAt: IsoDateTimeString;
}

// GET /invitations/:token's shape, deliberately narrower than Invitation:
// it is served to somebody who is not authenticated and not yet a member,
// so it carries only what the accept screen needs to decide whether to
// continue, never the organisation's internal id, the inviter's id, or
// anything that would leak to an unauthenticated caller who guesses at a
// token.
export interface InvitationPreview {
  organisationName: string;
  invitedByDisplayName: string;
  email: string;
  roles: OrganisationRole[];
  expiresAt: IsoDateTimeString;
  // Derived, not stored: lets the accept screen say why a link no longer
  // works (already used, withdrawn, timed out) instead of a bare 404 that
  // reads as the link being wrong rather than resolved.
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
}
