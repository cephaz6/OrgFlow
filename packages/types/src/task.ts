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

// GET /task-decision-tokens/:token's shape: served to somebody with no
// session at all (invitations.ts's InvitationPreview is the same shape of
// exception), so it carries only what the confirm screen needs to show
// before the recipient clicks "Approve", never an organisation or task id.
export interface TaskDecisionPreview {
  reference: string;
  processName: string;
  caseTitle: string;
  stepName: string;
  requesterName: string;
  dueAt: IsoDateTimeString | null;
  // Derived, not stored: lets the confirm screen say why a link no longer
  // works instead of a bare 404 that reads as the link being wrong rather
  // than resolved.
  status: 'pending' | 'used' | 'expired';
}
