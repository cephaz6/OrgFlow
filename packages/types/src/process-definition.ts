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
