import type { IsoDateTimeString, Uuid } from './common.js';
import type { OrganisationRole } from './membership.js';

// ADR-0010: carried directly in a signed, encrypted cookie. No server-side
// session store.
export interface SessionClaims {
  userId: Uuid;
  organisationId: Uuid | null;
  roles: OrganisationRole[];
  issuedAt: IsoDateTimeString;
  expiresAt: IsoDateTimeString;
}
