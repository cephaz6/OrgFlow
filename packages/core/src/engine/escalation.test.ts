import type {
  CaseState,
  EngineInput,
  EvaluationContext,
  ProcessDefinitionDocument,
  WorkflowStep,
} from '@orgflow/types';
import { describe, expect, it } from 'vitest';

import { advance } from './advance.js';

const SUBMITTER = '00000000-0000-0000-0000-000000000001';
const LINE_MANAGER = '00000000-0000-0000-0000-000000000002';
const MANAGER_OF_MANAGER = '00000000-0000-0000-0000-000000000003';
const IT_GROUP_ID = '00000000-0000-0000-0000-0000000000aa';

// A single approval step carrying a two-level escalation chain, matching
// the shape the Laptop Request seed uses: lineManagerOfAssignee first, a
// named role second.
const APPROVAL_STEP: WorkflowStep = {
  key: 'managerApproval',
  name: 'Line manager approval',
  type: 'approval',
  assignment: { strategy: 'lineManager' },
  allowedDecisions: ['approve', 'reject'],
  requireCommentOn: ['reject'],
  sla: {
    durationHours: 48,
    businessHoursOnly: false,
    reminders: [{ atHoursBefore: 12 }],
    escalation: [
      { strategy: 'lineManagerOfAssignee', atHoursAfter: 24 },
      { strategy: 'role', role: 'processOwner', atHoursAfter: 72 },
    ],
  },
  transitions: {
    approve: [{ when: null, to: '$completed' }],
    reject: [{ when: null, to: '$rejected' }],
  },
};

function definition(steps: WorkflowStep[] = [APPROVAL_STEP]): ProcessDefinitionDocument {
  return {
    organisationId: '00000000-0000-0000-0000-0000000000ff',
    definitionId: '00000000-0000-0000-0000-0000000000ee',
    versionNumber: 1,
    key: 'test-process',
    name: 'Test process',
    form: { titleFieldKey: '', sections: [] },
    workflow: { startStepKey: steps[0]!.key, steps },
    createdByUserId: SUBMITTER,
    createdAt: '2026-08-01T00:00:00.000Z',
  };
}

function context(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    now: '2026-08-14T12:00:00.000Z',
    correlationId: 'test-correlation',
    submitter: {
      userId: SUBMITTER,
      department: 'Engineering',
      roles: ['member'],
      lineManagerUserId: LINE_MANAGER,
    },
    case: { daysOpen: 0 },
    step: { escalationLevel: 0 },
    directory: { groupIdsByKey: { itSupport: IT_GROUP_ID }, activeDelegateByUserId: {} },
    ...overrides,
  };
}

function caseState(overrides: Partial<CaseState> = {}): CaseState {
  return {
    caseId: '00000000-0000-0000-0000-0000000000dd',
    definitionId: '00000000-0000-0000-0000-0000000000ee',
    versionId: '00000000-0000-0000-0000-0000000000cc',
    status: 'active',
    outcome: null,
    currentStepKey: 'managerApproval',
    ...overrides,
  };
}

// exactOptionalPropertyTypes rejects `{ ...step, sla: undefined }` (an
// explicit undefined is not the same as an omitted key); this omits it
// instead.
function withoutSla(step: WorkflowStep): WorkflowStep {
  const { sla: _sla, ...rest } = step;
  return rest;
}

function input(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    definition: definition(),
    caseState: caseState(),
    values: {},
    event: { type: 'escalationTriggered', taskId: 'task-1' },
    context: context(),
    ...overrides,
  };
}

describe('timer scheduling at task creation (PRD.md §15.2)', () => {
  it('schedules one reminder and one escalation timer per configured rule', () => {
    const output = advance({
      definition: definition(),
      caseState: caseState({ status: 'draft', currentStepKey: null }),
      values: {},
      event: { type: 'caseSubmitted' },
      context: context(),
    });

    // durationHours: 48, businessHoursOnly: false, so dueAt is exactly
    // 2026-08-16T12:00:00.000Z with no weekend adjustment.
    expect(output.timersToSchedule).toEqual([
      { timerType: 'reminder', escalationLevel: 0, fireAt: '2026-08-16T00:00:00.000Z' },
      { timerType: 'escalation', escalationLevel: 1, fireAt: '2026-08-17T12:00:00.000Z' },
      { timerType: 'escalation', escalationLevel: 2, fireAt: '2026-08-19T12:00:00.000Z' },
    ]);
  });

  it('schedules nothing for a step with no SLA', () => {
    const noSla: WorkflowStep = withoutSla(APPROVAL_STEP);
    const output = advance({
      definition: definition([noSla]),
      caseState: caseState({ status: 'draft', currentStepKey: null }),
      values: {},
      event: { type: 'caseSubmitted' },
      context: context(),
    });
    expect(output.timersToSchedule).toEqual([]);
  });
});

describe('timer cancellation on decision (PRD.md §15.2)', () => {
  it('cancels the decided task’s timers regardless of where the case goes next', () => {
    const output = advance(
      input({
        event: { type: 'taskDecided', taskId: 'task-1', decision: 'approve' },
      }),
    );
    expect(output.timersToCancel).toEqual(['task-1']);
  });
});

describe('escalationTriggered (PRD.md §15.3)', () => {
  it('adds an additional task at the resolved level, leaving the original untouched', () => {
    const output = advance(
      input({
        context: context({ currentAssignee: { lineManagerUserId: MANAGER_OF_MANAGER } }),
      }),
    );

    expect(output.errors).toEqual([]);
    expect(output.tasksToCreate).toEqual([
      expect.objectContaining({
        stepKey: 'managerApproval',
        assignmentStrategy: 'lineManagerOfAssignee',
        assigneeUserId: MANAGER_OF_MANAGER,
        escalationLevel: 1,
        dueAt: null,
      }),
    ]);
    // The case does not move: escalation adds an assignee, it does not
    // change where the workflow is.
    expect(output.caseUpdates.currentStepKey).toBeUndefined();
    expect(output.caseUpdates.status).toBeUndefined();
  });

  it('records the escalation as an audited transition', () => {
    const output = advance(
      input({
        context: context({ currentAssignee: { lineManagerUserId: MANAGER_OF_MANAGER } }),
      }),
    );
    expect(output.transitions).toEqual([
      expect.objectContaining({
        fromStepKey: 'managerApproval',
        toStepKey: 'managerApproval',
        triggerType: 'escalation',
        taskId: 'task-1',
      }),
    ]);
    expect(output.eventsToEmit.map((event) => event.eventType)).toEqual(['task.escalated']);
  });

  it('falls through to the next level when lineManagerOfAssignee resolves to nobody', () => {
    // context.currentAssignee is absent, so level 1 (lineManagerOfAssignee)
    // cannot resolve; level 2 (role: processOwner) can, unconditionally.
    const output = advance(input());

    expect(output.errors).toEqual([]);
    expect(output.tasksToCreate).toEqual([
      expect.objectContaining({
        assignmentStrategy: 'role',
        assigneeRole: 'processOwner',
        escalationLevel: 2,
      }),
    ]);
  });

  it('starts from one past the level already recorded on the task being escalated', () => {
    // A task already at level 1 (its first escalation already happened)
    // being escalated again should try level 2, not repeat level 1.
    const output = advance(
      input({
        context: context({
          step: { escalationLevel: 1 },
          currentAssignee: { lineManagerUserId: MANAGER_OF_MANAGER },
        }),
      }),
    );
    expect(output.tasksToCreate).toEqual([
      expect.objectContaining({ assignmentStrategy: 'role', escalationLevel: 2 }),
    ]);
  });

  it('flags the case for admin attention once every level is exhausted', () => {
    const output = advance(input({ context: context({ step: { escalationLevel: 2 } }) }));

    expect(output.tasksToCreate).toEqual([]);
    expect(output.errors[0]?.code).toBe('escalationLevelsExhausted');
    expect(output.caseUpdates.status).toBe('unassigned');
    // The case stays where it is: the original task is still open and
    // still actionable, only that nobody further could be added.
    expect(output.caseUpdates.currentStepKey).toBe('managerApproval');
  });

  it('reports rather than crashes when the case has no current step', () => {
    const output = advance(input({ caseState: caseState({ currentStepKey: null }) }));
    expect(output.errors[0]?.code).toBe('noCurrentStep');
  });
});

describe('self-approval guard (PRD.md §7)', () => {
  const selfApprovalInput = (overrides: Partial<EngineInput> = {}) =>
    input({
      caseState: caseState({ status: 'draft', currentStepKey: null }),
      event: { type: 'caseSubmitted' },
      // The submitter is also their own line manager, which is exactly the
      // self-approval trap the guard exists for.
      context: context({
        submitter: {
          userId: SUBMITTER,
          department: 'Engineering',
          roles: ['member'],
          lineManagerUserId: SUBMITTER,
        },
        currentAssignee: { lineManagerUserId: MANAGER_OF_MANAGER },
      }),
      ...overrides,
    });

  it('escalates one level instead of creating a self-assigned task', () => {
    const output = advance(selfApprovalInput());

    expect(output.errors.some((error) => error.code === 'selfApprovalGuard')).toBe(true);
    expect(output.tasksToCreate).toEqual([
      expect.objectContaining({
        assignmentStrategy: 'lineManagerOfAssignee',
        assigneeUserId: MANAGER_OF_MANAGER,
        escalationLevel: 1,
      }),
    ]);
    expect(output.caseUpdates.status).toBe('active');
  });

  it('is skipped entirely when allowSelfApproval is set', () => {
    const step: WorkflowStep = { ...APPROVAL_STEP, allowSelfApproval: true };
    const output = advance(selfApprovalInput({ definition: definition([step]) }));

    expect(output.errors).toEqual([]);
    expect(output.tasksToCreate).toEqual([
      expect.objectContaining({ assignmentStrategy: 'lineManager', assigneeUserId: SUBMITTER }),
    ]);
  });

  it('falls back to unassigned when no escalation level can take the task either', () => {
    const output = advance(
      selfApprovalInput({
        context: context({
          submitter: {
            userId: SUBMITTER,
            department: null,
            roles: [],
            lineManagerUserId: SUBMITTER,
          },
        }),
      }),
    );
    // No currentAssignee supplied this time, so lineManagerOfAssignee
    // cannot resolve, but role: processOwner still can, so the guard only
    // truly gives up when nothing resolves at all, covered next.
    expect(output.tasksToCreate).toEqual([
      expect.objectContaining({ assignmentStrategy: 'role', escalationLevel: 2 }),
    ]);
  });

  it('truly gives up when the self-approval guard cannot escalate at all', () => {
    const noEscalation: WorkflowStep = withoutSla(APPROVAL_STEP);
    const output = advance(
      selfApprovalInput({
        definition: definition([noEscalation]),
        context: context({
          submitter: {
            userId: SUBMITTER,
            department: null,
            roles: [],
            lineManagerUserId: SUBMITTER,
          },
        }),
      }),
    );
    expect(output.errors.some((error) => error.code === 'selfApprovalGuardUnresolved')).toBe(true);
    expect(output.caseUpdates.status).toBe('unassigned');
  });

  it('does not apply to a step that opted out via allowSelfApproval, even without escalation configured', () => {
    const step: WorkflowStep = { ...withoutSla(APPROVAL_STEP), allowSelfApproval: true };
    const output = advance(
      selfApprovalInput({
        definition: definition([step]),
        context: context({
          submitter: {
            userId: SUBMITTER,
            department: null,
            roles: [],
            lineManagerUserId: SUBMITTER,
          },
        }),
      }),
    );
    expect(output.errors).toEqual([]);
    expect(output.tasksToCreate).toEqual([expect.objectContaining({ assigneeUserId: SUBMITTER })]);
  });
});
