// Response shapes the API returns for cases. Shared by the server and
// client transports below, which are separate modules because one of them
// reaches for next/headers and must never enter a browser bundle.
import type { CaseOutcome, CaseStatus, CaseTask, ProcessDefinitionDocument } from '@orgflow/types';

export interface CaseResponse {
  caseId: string;
  definitionId: string;
  versionId: string;
  reference: string;
  title: string;
  status: CaseStatus;
  outcome: CaseOutcome | null;
  currentStepKey: string | null;
  submittedByUserId: string;
  submittedAt: string | null;
  completedAt: string | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TimelineEntry =
  | {
      kind: 'transition';
      occurredAt: string;
      fromStepKey: string | null;
      toStepKey: string | null;
      triggerType: string;
      triggeredByUserId: string | null;
      conditionResult: Record<string, unknown> | null;
    }
  | {
      kind: 'decision';
      occurredAt: string;
      taskId: string;
      stepKey: string;
      stepName: string;
      decision: string;
      comment: string | null;
      actorUserId: string | null;
    }
  | {
      kind: 'audit';
      occurredAt: string;
      action: string;
      actorUserId: string | null;
      payload: Record<string, unknown>;
    };

export interface CaseDetail {
  case: CaseResponse;
  values: Record<string, unknown>;
  tasks: CaseTask[];
  timeline: TimelineEntry[];
  // The document the case is pinned to, so its answers are labelled with
  // the questions it was actually asked rather than whatever the current
  // version happens to ask now (PRD.md §8.2).
  document: ProcessDefinitionDocument;
}

export interface CasePage {
  data: CaseResponse[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CaseEnvelope {
  case: CaseResponse;
}
