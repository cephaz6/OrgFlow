import type { CaseOutcome, CaseStatus } from './case.js';
import type { IsoDateTimeString, Uuid } from './common.js';
import type { ProcessDefinitionDocument, WorkflowDecisionAction } from './definition-document.js';
import type { DomainEvent } from './events.js';
import type { OrganisationRole } from './membership.js';
import type { TaskType } from './task.js';
import type { TransitionTriggerType } from './transition.js';

export interface EvaluationContext {
  now: IsoDateTimeString;
  submitter: {
    userId: Uuid;
    department: string | null;
    roles: OrganisationRole[];
  };
  case: {
    daysOpen: number;
  };
  step: {
    escalationLevel: number;
  };
}

export interface CaseState {
  caseId: Uuid;
  definitionId: Uuid;
  versionId: Uuid;
  status: CaseStatus;
  outcome: CaseOutcome | null;
  currentStepKey: string | null;
}

export type EngineEvent =
  | { type: 'caseSubmitted' }
  | {
      type: 'taskDecided';
      taskId: Uuid;
      decision: WorkflowDecisionAction;
      comment?: string;
      outputValues?: Record<string, unknown>;
    }
  | { type: 'taskExpired'; taskId: Uuid }
  | { type: 'escalationTriggered'; taskId: Uuid }
  | { type: 'caseCancelled'; reason?: string }
  | { type: 'caseResubmitted' };

// Mirrors the case_tasks columns set at creation; the assignee fields are the
// resolved outcome of the step's AssignmentStrategy, not the strategy itself.
export interface TaskSpec {
  stepKey: string;
  stepName: string;
  taskType: TaskType;
  assignmentStrategy: string;
  assigneeUserId: Uuid | null;
  assigneeGroupId: Uuid | null;
  assigneeRole: string | null;
  delegatedFromUserId: Uuid | null;
  allowedDecisions: WorkflowDecisionAction[];
  dueAt: IsoDateTimeString | null;
}

export interface TransitionRecord {
  fromStepKey: string | null;
  toStepKey: string | null;
  triggerType: TransitionTriggerType;
  taskId?: Uuid;
  conditionResult?: Record<string, unknown>;
}

export type TimerType = 'reminder' | 'escalation' | 'expiry';

export interface TimerSpec {
  taskId?: Uuid;
  timerType: TimerType;
  escalationLevel: number;
  fireAt: IsoDateTimeString;
}

export interface EngineError {
  code: string;
  message: string;
  stepKey?: string;
}

export interface EngineInput {
  definition: ProcessDefinitionDocument;
  caseState: CaseState;
  values: Record<string, unknown>;
  event: EngineEvent;
  context: EvaluationContext;
}

export interface EngineOutput {
  caseUpdates: Partial<CaseState>;
  tasksToCreate: TaskSpec[];
  tasksToCancel: Uuid[];
  transitions: TransitionRecord[];
  eventsToEmit: DomainEvent[];
  timersToSchedule: TimerSpec[];
  timersToCancel: Uuid[];
  errors: EngineError[];
}
