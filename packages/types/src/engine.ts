import type { CaseOutcome, CaseStatus } from './case.js';
import type { IsoDateTimeString, Uuid } from './common.js';
import type { ProcessDefinitionDocument, WorkflowDecisionAction } from './definition-document.js';
import type { DomainEvent } from './events.js';
import type { OrganisationRole } from './membership.js';
import type { TaskType } from './task.js';
import type { TransitionTriggerType } from './transition.js';

export interface EvaluationContext {
  now: IsoDateTimeString;
  // Propagated onto every emitted DomainEvent. PRD.md §11.10 requires a
  // correlation id to travel across HTTP, SNS and SQS boundaries, and the
  // engine cannot invent one without breaking the determinism §6.4
  // requires, so the caller supplies it.
  correlationId: string;
  submitter: {
    userId: Uuid;
    department: string | null;
    roles: OrganisationRole[];
    // Needed by the `lineManager` assignment strategy (PRD.md §7), which
    // is the very first step of most approval processes. The engine
    // performs no I/O, so the caller resolves it from
    // organisation_members.line_manager_user_id and passes it in.
    lineManagerUserId: Uuid | null;
  };
  case: {
    daysOpen: number;
  };
  step: {
    escalationLevel: number;
  };
  // Set only when the caller is resolving an escalation (a sweep finding an
  // overdue task, or the self-approval guard). `lineManagerOfAssignee`
  // (PRD.md §7) escalates the *current* assignee's manager, not the
  // submitter's, and the engine performs no I/O to find out who that is.
  currentAssignee?: {
    lineManagerUserId: Uuid | null;
  };
  // Directory facts the caller resolves before invoking the engine.
  // Assignment strategies name a group by its stable key, but case_tasks
  // stores a group id, and turning one into the other is a database
  // lookup the engine is not allowed to make.
  directory: {
    groupIdsByKey: Record<string, Uuid>;
    // PRD.md §7: "delegation is applied at resolution time." Keyed by the
    // user a strategy resolved to; a present entry means that user has an
    // active delegation covering `context.now`, and the engine redirects to
    // the delegate. Resolved by the caller for the same reason
    // groupIdsByKey is: it is a database lookup, not an engine decision.
    activeDelegateByUserId: Record<Uuid, Uuid>;
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
  // Absent (defaults to 0 at the database layer) for a task created by
  // entering a step normally. Set on the additional task an escalation
  // creates (PRD.md §15.3: escalation adds an assignee, it does not
  // replace one), so both the original and the escalated task agree on
  // which level produced them.
  escalationLevel?: number;
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
