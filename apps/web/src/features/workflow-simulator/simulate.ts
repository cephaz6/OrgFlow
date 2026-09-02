import { advance } from '@orgflow/core';
import type {
  CaseState,
  EngineEvent,
  EngineOutput,
  EvaluationContext,
  OrganisationRole,
  ProcessDefinitionDocument,
  TaskSpec,
  WorkflowDecisionAction,
} from '@orgflow/types';

// ADR-0040: the real engine, driven in the browser and never persisted.
// `advance` returns what should happen and the caller performs it; a caller
// that performs none of it is a legitimate caller, which is what makes this
// feature nearly free.

// Fixed ids, so a simulation is deterministic and two runs of the same
// inputs produce the same trace. None of these ever reaches a database.
const SIMULATED_SUBMITTER = '00000000-0000-4000-8000-000000000001';
const SIMULATED_LINE_MANAGER = '00000000-0000-4000-8000-000000000002';
const SIMULATED_CASE = '00000000-0000-4000-8000-0000000000c0';
const SIMULATED_VERSION = '00000000-0000-4000-8000-0000000000a0';

export interface SimulationContextInput {
  department: string | null;
  roles: OrganisationRole[];
  // The absence of a line manager is one of the more interesting things to
  // simulate, since it is what sends a `lineManager` step to `unassigned`,
  // so it is a toggle rather than a value.
  hasLineManager: boolean;
  now: string;
}

export interface OpenTask {
  taskId: string;
  spec: TaskSpec;
}

export interface SimulationEntry {
  event: EngineEvent;
  output: EngineOutput;
  // The case as it stood after this engine call, so the trace can be read
  // top to bottom without replaying it.
  caseState: CaseState;
}

export interface SimulationState {
  caseState: CaseState;
  entries: SimulationEntry[];
  openTasks: OpenTask[];
  nextTaskNumber: number;
}

export function isFinished(state: SimulationState): boolean {
  return state.caseState.status !== 'active' && state.caseState.status !== 'draft';
}

// A `group` strategy names a group by key, and the engine turns that into an
// id through `directory.groupIdsByKey`, which is a database lookup in
// production. Scanning the definition for the keys it actually mentions and
// synthesising an id for each means a group step resolves during a
// simulation, so a failure to resolve reflects the workflow rather than the
// simulation's own missing directory.
export function groupIdsFromDefinition(
  definition: ProcessDefinitionDocument,
): Record<string, string> {
  const ids: Record<string, string> = {};
  let counter = 1;

  for (const step of definition.workflow.steps) {
    const strategies = [step.assignment, ...(step.sla?.escalation ?? [])];
    for (const strategy of strategies) {
      if (strategy.strategy === 'group' && !(strategy.groupKey in ids)) {
        // A distinct prefix from the simulated people above, so a group id
        // and a user id can never collide in a trace being read by eye.
        ids[strategy.groupKey] = `00000000-0000-4000-8000-b${String(counter).padStart(11, '0')}`;
        counter += 1;
      }
    }
  }

  return ids;
}

export function buildContext(
  input: SimulationContextInput,
  definition: ProcessDefinitionDocument,
): EvaluationContext {
  return {
    now: input.now,
    correlationId: 'simulation',
    submitter: {
      userId: SIMULATED_SUBMITTER,
      department: input.department,
      roles: input.roles,
      lineManagerUserId: input.hasLineManager ? SIMULATED_LINE_MANAGER : null,
    },
    case: { daysOpen: 0 },
    step: { escalationLevel: 0 },
    directory: {
      groupIdsByKey: groupIdsFromDefinition(definition),
      // Delegation is resolved by the caller from a database table. A
      // simulation has no delegations, which is the honest default: the
      // owner is asking what the workflow does, not who happens to be on
      // leave today.
      activeDelegateByUserId: {},
    },
  };
}

function draftCase(definition: ProcessDefinitionDocument): CaseState {
  return {
    caseId: SIMULATED_CASE,
    definitionId: definition.definitionId,
    versionId: SIMULATED_VERSION,
    status: 'draft',
    outcome: null,
    currentStepKey: null,
  };
}

// TaskSpec carries no id: ids belong to the persistence layer this feature
// deliberately does not have, so the simulator assigns its own.
function adoptTasks(
  state: Pick<SimulationState, 'nextTaskNumber'>,
  output: EngineOutput,
): { tasks: OpenTask[]; nextTaskNumber: number } {
  let nextTaskNumber = state.nextTaskNumber;
  const tasks = output.tasksToCreate.map((spec) => {
    const taskId = `sim-task-${nextTaskNumber}`;
    nextTaskNumber += 1;
    return { taskId, spec };
  });
  return { tasks, nextTaskNumber };
}

function applyOutput(
  previous: SimulationState,
  event: EngineEvent,
  output: EngineOutput,
  cancelledTaskIds: string[],
): SimulationState {
  const caseState: CaseState = { ...previous.caseState, ...output.caseUpdates };
  const { tasks, nextTaskNumber } = adoptTasks(previous, output);

  const surviving = previous.openTasks.filter(
    (task) =>
      !cancelledTaskIds.includes(task.taskId) && !output.tasksToCancel.includes(task.taskId),
  );

  return {
    caseState,
    entries: [...previous.entries, { event, output, caseState }],
    openTasks: [...surviving, ...tasks],
    nextTaskNumber,
  };
}

export function startSimulation(
  definition: ProcessDefinitionDocument,
  values: Record<string, unknown>,
  context: EvaluationContext,
): SimulationState {
  const caseState = draftCase(definition);
  const event: EngineEvent = { type: 'caseSubmitted' };
  const output = advance({ definition, caseState, values, event, context });

  return applyOutput(
    { caseState, entries: [], openTasks: [], nextTaskNumber: 1 },
    event,
    output,
    [],
  );
}

export function decide(
  state: SimulationState,
  definition: ProcessDefinitionDocument,
  values: Record<string, unknown>,
  context: EvaluationContext,
  taskId: string,
  decision: WorkflowDecisionAction,
): SimulationState {
  const event: EngineEvent = { type: 'taskDecided', taskId, decision };
  const output = advance({
    definition,
    caseState: state.caseState,
    values,
    event,
    context,
  });

  // The decided task closes whether or not the engine lists it in
  // tasksToCancel: in production it is the row the decision was written
  // against, not something the engine cancels.
  return applyOutput(state, event, output, [taskId]);
}
