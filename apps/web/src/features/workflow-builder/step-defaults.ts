import type {
  AssignmentStrategy,
  StepType,
  TerminalStepKey,
  WorkflowDecisionAction,
  WorkflowStep,
} from '@orgflow/types';

export const STEP_TYPE_LABELS: Record<StepType, string> = {
  approval: 'Approval',
  action: 'Action',
  acknowledgement: 'Acknowledgement',
  automatic: 'Automatic',
};

export const DECISION_LABELS: Record<WorkflowDecisionAction, string> = {
  approve: 'Approve',
  reject: 'Reject',
  return: 'Return to requester',
  complete: 'Complete',
};

// The decisions each step type can offer, and what it starts with. An
// approval defaults to approve/reject, the two decisions PRD.md §4 uses in
// every example; a process owner can still add return or narrow the set
// afterwards.
export const DEFAULT_DECISIONS_BY_TYPE: Record<StepType, WorkflowDecisionAction[]> = {
  approval: ['approve', 'reject'],
  action: ['complete'],
  acknowledgement: ['complete'],
  automatic: ['complete'],
};

export const TERMINAL_KEYS: TerminalStepKey[] = [
  '$completed',
  '$rejected',
  '$cancelled',
  '$returnedToRequester',
];

export const TERMINAL_LABELS: Record<TerminalStepKey, string> = {
  $completed: 'Completed',
  $rejected: 'Rejected',
  $cancelled: 'Cancelled',
  $returnedToRequester: 'Returned to requester',
};

export function isTerminalKey(key: string): key is TerminalStepKey {
  return (TERMINAL_KEYS as string[]).includes(key);
}

// The assignment strategies exposed in the builder. specificUser is left
// out: PRD.md's document format supports it, but pointing a step at one
// named person is an edge case this builder does not need a user picker
// for yet, and a document carrying one (written outside the builder) still
// round-trips through save untouched as long as this editor is not opened
// for that step, the same scoping choice ConditionEditor makes for nested
// conditions.
export type BuilderAssignmentStrategy = Exclude<AssignmentStrategy['strategy'], 'specificUser'>;

export const ASSIGNMENT_LABELS: Record<BuilderAssignmentStrategy, string> = {
  lineManager: "Requester's line manager",
  lineManagerOfAssignee: "Previous assignee's line manager",
  submitter: 'The requester',
  role: 'Anyone with a role',
  group: 'A named group',
  fieldReference: 'Whoever the requester named',
};

export function blankStep(key: string, name: string, type: StepType): WorkflowStep {
  return {
    key,
    name,
    type,
    assignment: { strategy: 'lineManager' },
    allowedDecisions: DEFAULT_DECISIONS_BY_TYPE[type],
    transitions: {},
  };
}
