import type { IsoDateTimeString, Uuid } from './common.js';

export type ProcessDefinitionStatus = 'draft' | 'published' | 'archived';

export type ProcessVersionStatus = 'draft' | 'published' | 'archived';

export interface ProcessDefinition {
  definitionId: Uuid;
  organisationId: Uuid;
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  icon: string | null;
  status: ProcessDefinitionStatus;
  currentVersionId: Uuid | null;
  referencePrefix: string;
  referenceCounter: number;
  retentionDays: number | null;
  // ADR-0027: optional, additive. A processOwner who is also a member of
  // this group may manage the definition, alongside its creator.
  owningGroupId: Uuid | null;
  createdByUserId: Uuid;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

export interface ProcessVersion {
  versionId: Uuid;
  organisationId: Uuid;
  definitionId: Uuid;
  versionNumber: number;
  documentId: string;
  documentHash: string;
  status: ProcessVersionStatus;
  changeNote: string | null;
  publishedByUserId: Uuid | null;
  publishedAt: IsoDateTimeString | null;
  createdAt: IsoDateTimeString;
}
