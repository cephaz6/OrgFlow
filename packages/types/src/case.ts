import type { IsoDateTimeString, Uuid } from './common.js';

export type CaseStatus = 'draft' | 'active' | 'completed' | 'rejected' | 'cancelled' | 'unassigned';

export type CaseOutcome = 'approved' | 'rejected' | 'cancelled' | 'withdrawn';

export interface Case {
  caseId: Uuid;
  organisationId: Uuid;
  definitionId: Uuid;
  versionId: Uuid;
  reference: string;
  title: string;
  status: CaseStatus;
  outcome: CaseOutcome | null;
  currentStepKey: string | null;
  valuesDocumentId: string | null;
  submittedByUserId: Uuid;
  submittedAt: IsoDateTimeString | null;
  completedAt: IsoDateTimeString | null;
  dueAt: IsoDateTimeString | null;
  rowVersion: number;
  redactedAt: IsoDateTimeString | null;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}
