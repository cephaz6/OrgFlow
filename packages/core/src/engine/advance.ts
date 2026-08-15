import type {
  CaseState,
  DomainEvent,
  DomainEventType,
  EngineError,
  EngineInput,
  EngineOutput,
  ProcessDefinitionDocument,
  TaskSpec,
  TaskType,
  TransitionRecord,
  WorkflowStep,
} from '@orgflow/types';

import { evaluateCondition } from '../conditions/evaluate.js';
import { resolveAssignmentWithValues } from './assignment.js';
import { computeDueAt } from './sla.js';

// PRD.md §4.1: reserved terminal step keys, never user-definable.
const TERMINAL_OUTCOMES = {
  $completed: { status: 'completed', outcome: 'approved', event: 'case.completed' },
  $rejected: { status: 'rejected', outcome: 'rejected', event: 'case.rejected' },
  $cancelled: { status: 'cancelled', outcome: 'cancelled', event: 'case.cancelled' },
} as const satisfies Record<
  string,
  { status: CaseState['status']; outcome: CaseState['outcome']; event: DomainEventType }
>;

const RETURNED_STEP_KEY = '$returnedToRequester';

// PRD.md §6.3 step 7: automatic steps chain without creating tasks, so a
// definition with a cycle would spin forever. The guard is a definition
// defect surfacing as an engine error, not a crash.
const MAX_AUTOMATIC_STEPS = 20;

// See the call site in runFromStepKey: an automatic step has no decision,
// so its transitions are looked up under this fixed key.
const AUTOMATIC_STEP_TRANSITION_KEY = 'complete';

function isTerminalKey(key: string): key is keyof typeof TERMINAL_OUTCOMES {
  return key in TERMINAL_OUTCOMES;
}

function findStep(
  definition: ProcessDefinitionDocument,
  stepKey: string,
): WorkflowStep | undefined {
  return definition.workflow.steps.find((step) => step.key === stepKey);
}

// The engine emits events but cannot invent identifiers without breaking
// the determinism PRD.md §6.4 requires. Deriving the id from the case, the
// type, the injected clock and the position within this advance keeps it
// deterministic and unique, and it makes redelivery of the same logical
// event carry the same id, which is exactly what the consumer contract in
// §10 dedupes on.
function buildEvent(
  eventType: DomainEventType,
  input: EngineInput,
  payload: Record<string, unknown>,
  index: number,
): DomainEvent {
  return {
    eventId: `${input.caseState.caseId}:${eventType}:${input.context.now}:${index}`,
    eventType,
    // Taken from the pinned definition rather than the payload: the
    // envelope's organisationId is what consumers re-assert tenancy on
    // (PRD.md §10), so it must not depend on a caller remembering to put
    // it in the payload.
    organisationId: input.definition.organisationId,
    occurredAt: input.context.now,
    actorUserId: input.context.submitter.userId,
    actorType: 'user',
    correlationId: input.context.correlationId,
    payload,
    schemaVersion: 1,
  };
}

interface AdvanceState {
  output: EngineOutput;
  eventIndex: number;
}

function emit(
  state: AdvanceState,
  input: EngineInput,
  eventType: DomainEventType,
  payload: Record<string, unknown>,
): void {
  state.output.eventsToEmit.push(buildEvent(eventType, input, payload, state.eventIndex));
  state.eventIndex += 1;
}

function fail(code: string, message: string, stepKey?: string): EngineError {
  return stepKey ? { code, message, stepKey } : { code, message };
}

// PRD.md §6.4: "Every state change produces a transition record. There are
// no silent transitions." Moving a case to `unassigned` is a state change
// like any other, so it records one rather than leaving an unexplained gap
// in the timeline between the last recorded step and a case that has
// mysteriously stopped. §7 makes the same point from the other direction:
// unassigned is explicit and visible, requiring administrative action.
function enterUnassigned(
  state: AdvanceState,
  input: EngineInput,
  options: {
    stepKey: string | null;
    fromStepKey: string | null;
    triggerType: TransitionRecord['triggerType'];
    error: EngineError;
    strategy?: string;
  },
): void {
  state.output.caseUpdates.status = 'unassigned';
  state.output.caseUpdates.currentStepKey = options.stepKey;
  state.output.errors.push(options.error);

  state.output.transitions.push({
    fromStepKey: options.fromStepKey,
    toStepKey: options.stepKey,
    triggerType: options.triggerType,
    conditionResult: { unassignedReason: options.error.code, message: options.error.message },
  });

  emit(state, input, 'case.unassigned', {
    caseId: input.caseState.caseId,
    stepKey: options.stepKey,
    ...(options.strategy ? { strategy: options.strategy } : {}),
  });
}

// Enters a step: resolves assignment, creates the task, records the
// transition. Returns the next step key when the step is automatic and the
// machine should keep going, or null when it should stop.
function enterStep(
  state: AdvanceState,
  input: EngineInput,
  step: WorkflowStep,
  // Passed separately rather than read off the step, because StepType
  // includes 'automatic' while TaskType does not. The caller has already
  // narrowed it, so this parameter is what makes "an automatic step never
  // creates a task" a type-level guarantee rather than a comment.
  taskType: TaskType,
  fromStepKey: string | null,
  triggerType: TransitionRecord['triggerType'],
  conditionResult: Record<string, unknown> | undefined,
): void {
  const assignment = resolveAssignmentWithValues(step.assignment, input.context, input.values);

  if (!assignment.resolved) {
    // PRD.md §6.3 step 6 and §7: resolution yielding nobody is an explicit,
    // visible state requiring administrative action, never a silent
    // failure.
    enterUnassigned(state, input, {
      stepKey: step.key,
      fromStepKey,
      triggerType,
      error: fail(
        'assignmentUnresolved',
        assignment.reason ?? 'Assignment resolved to nobody.',
        step.key,
      ),
      strategy: step.assignment.strategy,
    });
    return;
  }

  const dueAt = computeDueAt(step.sla, input.context.now);

  const task: TaskSpec = {
    stepKey: step.key,
    stepName: step.name,
    taskType,
    assignmentStrategy: step.assignment.strategy,
    assigneeUserId: assignment.assigneeUserId,
    assigneeGroupId: assignment.assigneeGroupId,
    assigneeRole: assignment.assigneeRole,
    delegatedFromUserId: null,
    allowedDecisions: step.allowedDecisions,
    dueAt,
  };

  state.output.tasksToCreate.push(task);
  state.output.caseUpdates.status = 'active';
  state.output.caseUpdates.currentStepKey = step.key;

  state.output.transitions.push({
    fromStepKey,
    toStepKey: step.key,
    triggerType,
    ...(conditionResult ? { conditionResult } : {}),
  });

  emit(state, input, 'task.created', {
    caseId: input.caseState.caseId,
    stepKey: step.key,
    assigneeUserId: assignment.assigneeUserId,
    assigneeRole: assignment.assigneeRole,
    assigneeGroupId: assignment.assigneeGroupId,
    dueAt,
  });
  emit(state, input, 'case.stepChanged', {
    caseId: input.caseState.caseId,
    fromStepKey,
    toStepKey: step.key,
    conditionResult: conditionResult ?? null,
  });
}

// PRD.md §6.3 step 4 also says to cancel outstanding tasks and timers on
// reaching a terminal step. The engine cannot name them: EngineInput
// carries the case state, not its task rows, so tasksToCancel would be a
// list the engine has no way to populate. The caller cancels every open
// task for the case instead (cancelOpenTasksForCase in packages/db), in
// the same transaction that applies these updates.
function enterTerminal(
  state: AdvanceState,
  input: EngineInput,
  terminalKey: keyof typeof TERMINAL_OUTCOMES,
  fromStepKey: string | null,
  triggerType: TransitionRecord['triggerType'],
  conditionResult: Record<string, unknown> | undefined,
): void {
  const terminal = TERMINAL_OUTCOMES[terminalKey];

  state.output.caseUpdates.status = terminal.status;
  state.output.caseUpdates.outcome = terminal.outcome;
  state.output.caseUpdates.currentStepKey = null;

  state.output.transitions.push({
    fromStepKey,
    toStepKey: terminalKey,
    triggerType,
    ...(conditionResult ? { conditionResult } : {}),
  });

  emit(state, input, terminal.event, {
    caseId: input.caseState.caseId,
    fromStepKey,
  });
}

// PRD.md §6.3 step 3: read transitions[decision], evaluate each `when` in
// order, take the first true. §5.4 requires the default (`when: null`) to
// be last, which publish-time validation enforces.
function selectNextStepKey(
  state: AdvanceState,
  input: EngineInput,
  step: WorkflowStep,
  decision: string,
): { nextStepKey: string; conditionResult: Record<string, unknown> } | null {
  const rules = step.transitions[decision];

  if (!rules || rules.length === 0) {
    state.output.errors.push(
      fail(
        'noTransitionForDecision',
        `Step '${step.key}' defines no transition for decision '${decision}'.`,
        step.key,
      ),
    );
    return null;
  }

  const evaluatedRules: Array<{ to: string; matched: boolean; warnings: string[] }> = [];

  for (const rule of rules) {
    const evaluation = evaluateCondition(rule.when, {
      values: input.values,
      context: input.context,
    });
    evaluatedRules.push({
      to: rule.to,
      matched: evaluation.matched,
      warnings: evaluation.warnings,
    });

    if (evaluation.matched) {
      return {
        nextStepKey: rule.to,
        // Recorded on the transition row: PRD.md §2.3 calls this "which
        // branch was taken and why", so it carries the losing branches too.
        conditionResult: { decision, chosen: rule.to, evaluated: evaluatedRules },
      };
    }
  }

  // PRD.md §6.3 step 3c: nothing matched and no default exists. A
  // definition validation failure, recorded as an engine error, moving the
  // case to unassigned rather than crashing.
  state.output.errors.push(
    fail(
      'noMatchingTransition',
      `No transition matched decision '${decision}' on step '${step.key}', and no default branch exists.`,
      step.key,
    ),
  );
  return null;
}

function runFromStepKey(
  state: AdvanceState,
  input: EngineInput,
  startKey: string,
  fromStepKey: string | null,
  triggerType: TransitionRecord['triggerType'],
  conditionResult: Record<string, unknown> | undefined,
): void {
  let currentKey = startKey;
  let previousKey = fromStepKey;
  let currentConditionResult = conditionResult;

  for (let iteration = 0; iteration < MAX_AUTOMATIC_STEPS; iteration += 1) {
    if (isTerminalKey(currentKey)) {
      enterTerminal(state, input, currentKey, previousKey, triggerType, currentConditionResult);
      return;
    }

    if (currentKey === RETURNED_STEP_KEY) {
      // PRD.md §6.3 step 5: the case stays active with no current step and
      // a task goes back to the submitter for amendment.
      state.output.caseUpdates.status = 'active';
      state.output.caseUpdates.currentStepKey = null;
      state.output.transitions.push({
        fromStepKey: previousKey,
        toStepKey: RETURNED_STEP_KEY,
        triggerType,
        ...(currentConditionResult ? { conditionResult: currentConditionResult } : {}),
      });
      state.output.tasksToCreate.push({
        stepKey: RETURNED_STEP_KEY,
        stepName: 'Amend and resubmit',
        taskType: 'action',
        assignmentStrategy: 'submitter',
        assigneeUserId: input.context.submitter.userId,
        assigneeGroupId: null,
        assigneeRole: null,
        delegatedFromUserId: null,
        allowedDecisions: ['complete'],
        dueAt: null,
      });
      emit(state, input, 'case.returned', {
        caseId: input.caseState.caseId,
        fromStepKey: previousKey,
      });
      return;
    }

    const step = findStep(input.definition, currentKey);
    if (!step) {
      enterUnassigned(state, input, {
        stepKey: currentKey,
        fromStepKey: previousKey,
        triggerType,
        error: fail(
          'unknownStep',
          `Step '${currentKey}' does not exist in this definition version.`,
        ),
      });
      return;
    }

    // Extracted so TypeScript narrows it: after this guard the remaining
    // StepType members are exactly the TaskType members.
    const stepType = step.type;
    if (stepType !== 'automatic') {
      enterStep(state, input, step, stepType, previousKey, triggerType, currentConditionResult);
      return;
    }

    // PRD.md §6.3 step 7: an automatic step creates no task and evaluates
    // its own transitions immediately.
    state.output.transitions.push({
      fromStepKey: previousKey,
      toStepKey: step.key,
      triggerType,
      ...(currentConditionResult ? { conditionResult: currentConditionResult } : {}),
    });

    // An automatic step has no decision, so there is no decision key to
    // look its transitions up by. PRD.md §6.3 step 7 says to re-enter step
    // 3 with "the automatic step's transitions" without naming the key, so
    // the convention here is `complete`, matching the single allowed
    // decision an automatic step would otherwise carry. A definition using
    // a different key gets a noTransitionForDecision error naming it,
    // rather than silently stalling.
    const selection = selectNextStepKey(state, input, step, AUTOMATIC_STEP_TRANSITION_KEY);
    if (!selection) {
      enterUnassigned(state, input, {
        stepKey: step.key,
        fromStepKey: previousKey,
        triggerType,
        // selectNextStepKey has already recorded the specific error.
        error: fail(
          'automaticStepStalled',
          `Automatic step '${step.key}' could not select a next step.`,
          step.key,
        ),
      });
      return;
    }

    previousKey = step.key;
    currentKey = selection.nextStepKey;
    currentConditionResult = selection.conditionResult;
  }

  enterUnassigned(state, input, {
    stepKey: previousKey,
    fromStepKey: previousKey,
    triggerType,
    error: fail(
      'automaticStepLimitExceeded',
      `More than ${MAX_AUTOMATIC_STEPS} automatic steps ran in a single advance; the definition probably contains a loop.`,
    ),
  });
}

function emptyOutput(): EngineOutput {
  return {
    caseUpdates: {},
    tasksToCreate: [],
    tasksToCancel: [],
    transitions: [],
    eventsToEmit: [],
    timersToSchedule: [],
    timersToCancel: [],
    errors: [],
  };
}

// PRD.md §6: the workflow engine as a pure state machine. Input is the
// current case state, the pinned definition version and a triggering
// event; output is what should happen. It performs no I/O, never mutates
// its inputs, and never throws on tenant data: invalid definitions produce
// EngineError entries. The caller persists everything returned here in one
// transaction, then publishes the events.
export function advance(input: EngineInput): EngineOutput {
  const state: AdvanceState = { output: emptyOutput(), eventIndex: 0 };
  const { caseState, definition, event } = input;

  // PRD.md §6.3 step 1: reject if the case is already terminal.
  if (['completed', 'rejected', 'cancelled'].includes(caseState.status)) {
    state.output.errors.push(
      fail('caseAlreadyTerminal', `Case is already ${caseState.status} and cannot advance.`),
    );
    return state.output;
  }

  switch (event.type) {
    case 'caseSubmitted': {
      if (caseState.status !== 'draft') {
        state.output.errors.push(
          fail(
            'caseNotDraft',
            `Only a draft case can be submitted; this one is ${caseState.status}.`,
          ),
        );
        return state.output;
      }

      emit(state, input, 'case.submitted', {
        caseId: caseState.caseId,
        versionId: caseState.versionId,
      });
      state.output.caseUpdates.status = 'active';
      runFromStepKey(state, input, definition.workflow.startStepKey, null, 'submission', undefined);
      return state.output;
    }

    case 'caseResubmitted': {
      // Only a returned case can be resubmitted. PRD.md §6.3 step 5 leaves
      // a returned case active with no current step, which is exactly the
      // shape checked here; an active case sitting on a step has an open
      // task and must be decided, not resubmitted.
      if (caseState.status !== 'active' || caseState.currentStepKey !== null) {
        state.output.errors.push(
          fail(
            'caseNotReturned',
            'Only a case that was returned to its requester can be resubmitted.',
          ),
        );
        return state.output;
      }

      emit(state, input, 'case.resubmitted', { caseId: caseState.caseId });
      runFromStepKey(state, input, definition.workflow.startStepKey, null, 'submission', undefined);
      return state.output;
    }

    case 'caseCancelled': {
      enterTerminal(state, input, '$cancelled', caseState.currentStepKey, 'admin', undefined);
      return state.output;
    }

    case 'taskDecided': {
      const currentStepKey = caseState.currentStepKey;
      if (!currentStepKey) {
        state.output.errors.push(
          fail('noCurrentStep', 'The case has no current step, so no decision can be recorded.'),
        );
        return state.output;
      }

      const step = findStep(definition, currentStepKey);
      if (!step) {
        state.output.errors.push(
          fail(
            'unknownStep',
            `Step '${currentStepKey}' does not exist in this definition version.`,
          ),
        );
        return state.output;
      }

      if (!step.allowedDecisions.includes(event.decision)) {
        state.output.errors.push(
          fail(
            'decisionNotAllowed',
            `Step '${step.key}' does not allow the decision '${event.decision}'.`,
            step.key,
          ),
        );
        return state.output;
      }

      if (step.requireCommentOn?.includes(event.decision) && !event.comment?.trim()) {
        state.output.errors.push(
          fail(
            'commentRequired',
            `Step '${step.key}' requires a comment when the decision is '${event.decision}'.`,
            step.key,
          ),
        );
        return state.output;
      }

      emit(state, input, 'task.decided', {
        caseId: caseState.caseId,
        taskId: event.taskId,
        decision: event.decision,
        comment: event.comment ?? null,
      });

      const selection = selectNextStepKey(state, input, step, event.decision);
      if (!selection) {
        enterUnassigned(state, input, {
          stepKey: step.key,
          fromStepKey: step.key,
          triggerType: 'decision',
          // selectNextStepKey has already recorded which of the two
          // possible faults it was.
          error: fail(
            'transitionSelectionFailed',
            `Step '${step.key}' could not route the decision '${event.decision}'.`,
            step.key,
          ),
        });
        return state.output;
      }

      runFromStepKey(
        state,
        input,
        selection.nextStepKey,
        step.key,
        'decision',
        selection.conditionResult,
      );
      return state.output;
    }

    case 'taskExpired':
    case 'escalationTriggered': {
      // Timers arrive with SLA and escalation in Phase 6. Reported as an
      // error rather than silently ignored, so a caller that fires one
      // early finds out.
      state.output.errors.push(
        fail('eventNotImplemented', `The '${event.type}' event is not implemented until Phase 6.`),
      );
      return state.output;
    }

    default: {
      const exhaustive: never = event;
      state.output.errors.push(
        fail('unknownEvent', `Unknown engine event: ${JSON.stringify(exhaustive)}`),
      );
      return state.output;
    }
  }
}
