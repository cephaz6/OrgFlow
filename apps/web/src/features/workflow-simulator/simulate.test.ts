import type { ProcessDefinitionDocument, WorkflowStep } from '@orgflow/types';
import { describe, expect, it } from 'vitest';

import {
  buildContext,
  decide,
  groupIdsFromDefinition,
  isFinished,
  startSimulation,
  type SimulationContextInput,
} from './simulate';

const MANAGER_APPROVAL: WorkflowStep = {
  key: 'managerApproval',
  name: 'Line manager approval',
  type: 'approval',
  assignment: { strategy: 'lineManager' },
  allowedDecisions: ['approve', 'reject'],
  transitions: {
    // Above 1,000 it needs finance as well, which is the branch a simulator
    // exists to make visible without submitting a real case.
    approve: [
      { when: { field: 'cost', operator: 'gt', value: 1000 }, to: 'financeApproval' },
      { when: null, to: '$completed' },
    ],
    reject: [{ when: null, to: '$rejected' }],
  },
};

const FINANCE_APPROVAL: WorkflowStep = {
  key: 'financeApproval',
  name: 'Finance approval',
  type: 'approval',
  assignment: { strategy: 'group', groupKey: 'finance' },
  allowedDecisions: ['approve', 'reject'],
  transitions: {
    approve: [{ when: null, to: '$completed' }],
    reject: [{ when: null, to: '$rejected' }],
  },
};

function definition(steps: WorkflowStep[] = [MANAGER_APPROVAL, FINANCE_APPROVAL]) {
  return {
    organisationId: '00000000-0000-4000-8000-0000000000ff',
    definitionId: '00000000-0000-4000-8000-0000000000ee',
    versionNumber: 1,
    key: 'laptop-request',
    name: 'Laptop request',
    form: { titleFieldKey: 'model', sections: [] },
    workflow: { startStepKey: 'managerApproval', steps },
    createdByUserId: '00000000-0000-4000-8000-000000000009',
    createdAt: '2026-09-01T09:00:00.000Z',
  } satisfies ProcessDefinitionDocument;
}

const BASE_CONTEXT: SimulationContextInput = {
  department: 'Engineering',
  roles: ['member'],
  hasLineManager: true,
  now: '2026-09-01T09:00:00.000Z',
};

function contextFor(overrides: Partial<SimulationContextInput> = {}) {
  const input = { ...BASE_CONTEXT, ...overrides };
  return buildContext(input, definition());
}

describe('groupIdsFromDefinition', () => {
  it('synthesises an id for every group key the workflow mentions', () => {
    const ids = groupIdsFromDefinition(definition());
    expect(Object.keys(ids)).toEqual(['finance']);
  });

  it('covers group keys named by an escalation rule, not only by a step assignment', () => {
    const escalating: WorkflowStep = {
      ...MANAGER_APPROVAL,
      sla: {
        durationHours: 48,
        escalation: [{ strategy: 'group', groupKey: 'itSupport', atHoursAfter: 24 }],
      },
    };
    const ids = groupIdsFromDefinition(definition([escalating, FINANCE_APPROVAL]));
    expect(Object.keys(ids).sort()).toEqual(['finance', 'itSupport']);
  });
});

describe('startSimulation', () => {
  it('opens the first task, resolved to the simulated line manager', () => {
    const state = startSimulation(definition(), { cost: 500 }, contextFor());

    expect(state.caseState.status).toBe('active');
    expect(state.caseState.currentStepKey).toBe('managerApproval');
    expect(state.openTasks).toHaveLength(1);
    expect(state.openTasks[0]!.taskId).toBe('sim-task-1');
    expect(state.openTasks[0]!.spec.assignmentStrategy).toBe('lineManager');
    expect(isFinished(state)).toBe(false);
  });

  it('leaves the case unassigned when the requester has no line manager', () => {
    const state = startSimulation(
      definition(),
      { cost: 500 },
      contextFor({ hasLineManager: false }),
    );

    expect(state.caseState.status).toBe('unassigned');
    expect(state.openTasks).toHaveLength(0);
    // Finished in the sense that the owner has nothing left to decide: the
    // workflow has stalled, which is exactly the finding worth surfacing.
    expect(isFinished(state)).toBe(true);
  });

  it('persists nothing and calls nothing, so the same inputs give the same trace', () => {
    const first = startSimulation(definition(), { cost: 500 }, contextFor());
    const second = startSimulation(definition(), { cost: 500 }, contextFor());
    expect(first.openTasks).toEqual(second.openTasks);
    expect(first.caseState).toEqual(second.caseState);
  });
});

describe('decide', () => {
  it('completes directly when the branch condition does not match', () => {
    const started = startSimulation(definition(), { cost: 500 }, contextFor());
    const next = decide(
      started,
      definition(),
      { cost: 500 },
      contextFor(),
      'sim-task-1',
      'approve',
    );

    expect(next.caseState.status).toBe('completed');
    expect(next.caseState.outcome).toBe('approved');
    expect(next.openTasks).toHaveLength(0);
    expect(isFinished(next)).toBe(true);
  });

  it('routes to finance when the same decision is taken on a costlier request', () => {
    const values = { cost: 2500 };
    const started = startSimulation(definition(), values, contextFor());
    const next = decide(started, definition(), values, contextFor(), 'sim-task-1', 'approve');

    expect(next.caseState.currentStepKey).toBe('financeApproval');
    expect(next.openTasks).toHaveLength(1);
    expect(next.openTasks[0]!.taskId).toBe('sim-task-2');
    expect(next.openTasks[0]!.spec.assignmentStrategy).toBe('group');
    expect(isFinished(next)).toBe(false);
  });

  it('closes the decided task rather than carrying it forward', () => {
    const values = { cost: 2500 };
    const started = startSimulation(definition(), values, contextFor());
    const next = decide(started, definition(), values, contextFor(), 'sim-task-1', 'approve');

    expect(next.openTasks.map((task) => task.taskId)).not.toContain('sim-task-1');
  });

  it('rejects to a terminal outcome', () => {
    const started = startSimulation(definition(), { cost: 500 }, contextFor());
    const next = decide(started, definition(), { cost: 500 }, contextFor(), 'sim-task-1', 'reject');

    expect(next.caseState.status).toBe('rejected');
    expect(next.caseState.outcome).toBe('rejected');
  });

  it('accumulates one trace entry per engine call', () => {
    const values = { cost: 2500 };
    const started = startSimulation(definition(), values, contextFor());
    const second = decide(started, definition(), values, contextFor(), 'sim-task-1', 'approve');
    const third = decide(second, definition(), values, contextFor(), 'sim-task-2', 'approve');

    expect(third.entries).toHaveLength(3);
    expect(third.entries.map((entry) => entry.event.type)).toEqual([
      'caseSubmitted',
      'taskDecided',
      'taskDecided',
    ]);
    expect(third.caseState.status).toBe('completed');
  });
});

describe('due dates and timers', () => {
  it('reports the computed deadline and its scheduled timers without persisting them', () => {
    const withSla: WorkflowStep = {
      ...MANAGER_APPROVAL,
      sla: {
        durationHours: 48,
        businessHoursOnly: false,
        reminders: [{ atHoursBefore: 12 }],
        escalation: [{ strategy: 'role', role: 'processOwner', atHoursAfter: 24 }],
      },
    };
    const state = startSimulation(
      definition([withSla, FINANCE_APPROVAL]),
      { cost: 500 },
      contextFor(),
    );

    // now is 2026-09-01T09:00Z, so 48 hours later is the 3rd, a Thursday.
    expect(state.openTasks[0]!.spec.dueAt).toBe('2026-09-03T09:00:00.000Z');
    expect(state.entries[0]!.output.timersToSchedule).toEqual([
      { timerType: 'reminder', escalationLevel: 0, fireAt: '2026-09-02T21:00:00.000Z' },
      { timerType: 'escalation', escalationLevel: 1, fireAt: '2026-09-04T09:00:00.000Z' },
    ]);
  });
});

describe('the self-approval guard', () => {
  it('surfaces as an engine error rather than a silent self-assignment', () => {
    const selfApproving: WorkflowStep = {
      ...MANAGER_APPROVAL,
      assignment: { strategy: 'submitter' },
    };
    const state = startSimulation(
      definition([selfApproving, FINANCE_APPROVAL]),
      { cost: 500 },
      contextFor(),
    );

    expect(state.entries[0]!.output.errors.map((error) => error.code)).toContain(
      'selfApprovalGuard',
    );
  });
});
