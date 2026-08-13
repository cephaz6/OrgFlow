import type { IsoDateTimeString, Uuid } from './common.js';

export type TransitionTriggerType =
  'submission' | 'decision' | 'escalation' | 'timer' | 'system' | 'admin';

export interface CaseTransition {
  transitionId: Uuid;
  organisationId: Uuid;
  caseId: Uuid;
  fromStepKey: string | null;
  toStepKey: string | null;
  triggerType: TransitionTriggerType;
  triggeredByUserId: Uuid | null;
  taskId: Uuid | null;
  conditionResult: Record<string, unknown> | null;
  occurredAt: IsoDateTimeString;
}
