import type { IsoDateTimeString, Uuid } from './common.js';

export type TaskType = 'approval' | 'action' | 'acknowledgement';

export type TaskStatus =
  'pending' | 'claimed' | 'completed' | 'skipped' | 'reassigned' | 'cancelled' | 'expired';

export type TaskDecision = 'approved' | 'rejected' | 'returned' | 'completed';

export interface CaseTask {
  taskId: Uuid;
  organisationId: Uuid;
  caseId: Uuid;
  stepKey: string;
  stepName: string;
  taskType: TaskType;
  assignmentStrategy: string;
  assigneeUserId: Uuid | null;
  assigneeGroupId: Uuid | null;
  assigneeRole: string | null;
  delegatedFromUserId: Uuid | null;
  status: TaskStatus;
  decision: TaskDecision | null;
  comment: string | null;
  dueAt: IsoDateTimeString | null;
  escalationLevel: number;
  escalatedAt: IsoDateTimeString | null;
  claimedByUserId: Uuid | null;
  claimedAt: IsoDateTimeString | null;
  completedByUserId: Uuid | null;
  completedAt: IsoDateTimeString | null;
  rowVersion: number;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}
