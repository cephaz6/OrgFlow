import type { IsoDateTimeString, Uuid } from './common.js';

export type OrganisationStatus = 'active' | 'suspended' | 'deleted';

export interface Organisation {
  organisationId: Uuid;
  name: string;
  slug: string;
  status: OrganisationStatus;
  branding: Record<string, unknown>;
  settings: Record<string, unknown>;
  createdByUserId: Uuid;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}
