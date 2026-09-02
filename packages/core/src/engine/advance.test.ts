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
const IT_GROUP_ID = '00000000-0000-0000-0000-0000000000aa';

// The workflow half of the Laptop Request definition, transcribed from
// PRD.md §4: manager approval, finance approval only above £1000, then IT
// fulfilment. This is the process Phase 1 actually runs.
const LAPTOP_STEPS: WorkflowStep[] = [
  {
    key: 'managerApproval',
    name: 'Line manager approval',
    type: 'approval',
    assignment: { strategy: 'lineManager' },
    allowedDecisions: ['approve', 'reject', 'return'],
    requireCommentOn: ['reject', 'return'],
    sla: { durationHours: 48, businessHoursOnly: true },
    transitions: {
      approve: [
        { when: { field: 'estimatedCost', operator: 'gt', value: 1000 }, to: 'financeApproval' },
        { when: null, to: 'itFulfilment' },
      ],
      reject: [{ when: null, to: '$rejected' }],
      return: [{ when: null, to: '$returnedToRequester' }],
    },
  },
  {
    key: 'financeApproval',
    name: 'Finance approval',
    type: 'approval',
    assignment: { strategy: 'role', role: 'approver' },
    allowedDecisions: ['approve', 'reject'],
    requireCommentOn: ['reject'],
    sla: { durationHours: 72, businessHoursOnly: true },
    transitions: {
      approve: [{ when: null, to: 'itFulfilment' }],
      reject: [{ when: null, to: '$rejected' }],
    },
  },
  {
    key: 'itFulfilment',
    name: 'IT fulfilment',
    type: 'action',
    assignment: { strategy: 'group', groupKey: 'itSupport' },
    allowedDecisions: ['complete'],
    sla: { durationHours: 120, businessHoursOnly: true },
    transitions: {
      complete: [{ when: null, to: '$completed' }],
    },
  },
];

function definition(steps: WorkflowStep[] = LAPTOP_STEPS): ProcessDefinitionDocument {
  return {
    organisationId: '00000000-0000-0000-0000-0000000000ff',
    definitionId: '00000000-0000-0000-0000-0000000000ee',
    versionNumber: 1,
    key: 'laptop-request',
    name: 'Laptop request',
    form: { titleFieldKey: 'laptopModel', sections: [] },
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
    status: 'draft',
    outcome: null,
    currentStepKey: null,
    ...overrides,
  };
}

function input(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    definition: definition(),
    caseState: caseState(),
    values: { laptopModel: 'mbp14', estimatedCost: 800 },
    event: { type: 'caseSubmitted' },
    context: context(),
    ...overrides,
  };
}

describe('submission', () => {
  it('activates the case and creates the first task for the line manager', () => {
    const output = advance(input());

    expect(output.errors).toEqual([]);
    expect(output.caseUpdates.status).toBe('active');
    expect(output.caseUpdates.currentStepKey).toBe('managerApproval');
    expect(output.tasksToCreate).toHaveLength(1);
    expect(output.tasksToCreate[0]).toMatchObject({
      stepKey: 'managerApproval',
      taskType: 'approval',
      assignmentStrategy: 'lineManager',
      assigneeUserId: LINE_MANAGER,
    });
    expect(output.transitions).toEqual([
      { fromStepKey: null, toStepKey: 'managerApproval', triggerType: 'submission' },
    ]);
    expect(output.eventsToEmit.map((event) => event.eventType)).toEqual([
      'case.submitted',
      'task.created',
      'case.stepChanged',
    ]);
  });

  it('computes dueAt from the step SLA', () => {
    const output = advance(input());
    // 48 working hours from the injected clock (a Friday), not the real
    // one. ADR-0044: those are hours of the working day, so they run out on
    // Monday the 24th rather than two calendar days later.
    expect(output.tasksToCreate[0]?.dueAt).toBe('2026-08-24T12:00:00.000Z');
  });

  it('refuses to submit a case that is not a draft', () => {
    const output = advance(input({ caseState: caseState({ status: 'active' }) }));
    expect(output.errors[0]?.code).toBe('caseNotDraft');
    expect(output.tasksToCreate).toEqual([]);
  });

  it('sends the case to unassigned when the submitter has no line manager', () => {
    // PRD.md §7: unassigned is explicit and visible, never a silent failure.
    const output = advance(
      input({
        context: context({
          submitter: {
            userId: SUBMITTER,
            department: 'Engineering',
            roles: ['member'],
            lineManagerUserId: null,
          },
        }),
      }),
    );

    expect(output.caseUpdates.status).toBe('unassigned');
    expect(output.tasksToCreate).toEqual([]);
    expect(output.errors[0]?.code).toBe('assignmentUnresolved');
    expect(output.eventsToEmit.map((event) => event.eventType)).toContain('case.unassigned');
  });
});

describe('the conditional finance branch (the Phase 1 architecture proof)', () => {
  const afterManagerApproval = {
    caseState: caseState({ status: 'active', currentStepKey: 'managerApproval' }),
    event: { type: 'taskDecided' as const, taskId: 'task-1', decision: 'approve' as const },
  };

  it('skips finance approval at or below £1000', () => {
    const output = advance(input({ ...afterManagerApproval, values: { estimatedCost: 1000 } }));

    expect(output.errors).toEqual([]);
    expect(output.caseUpdates.currentStepKey).toBe('itFulfilment');
    expect(output.tasksToCreate[0]).toMatchObject({
      stepKey: 'itFulfilment',
      assigneeGroupId: IT_GROUP_ID,
      assigneeUserId: null,
    });
  });

  it('routes through finance approval above £1000', () => {
    const output = advance(input({ ...afterManagerApproval, values: { estimatedCost: 1200 } }));

    expect(output.errors).toEqual([]);
    expect(output.caseUpdates.currentStepKey).toBe('financeApproval');
    expect(output.tasksToCreate[0]).toMatchObject({
      stepKey: 'financeApproval',
      assigneeRole: 'approver',
      assigneeUserId: null,
    });
  });

  it('records which branch was taken and why on the transition', () => {
    const output = advance(input({ ...afterManagerApproval, values: { estimatedCost: 1200 } }));

    // PRD.md §2.3 calls conditionResult "which branch was taken and why",
    // so the losing branches have to be legible too.
    expect(output.transitions[0]?.conditionResult).toMatchObject({
      decision: 'approve',
      chosen: 'financeApproval',
    });
  });

  it('still routes somewhere sensible when the cost is missing entirely', () => {
    // The condition is unevaluable, so it is false, so the default branch
    // wins. A missing field must never strand a case.
    const output = advance(input({ ...afterManagerApproval, values: {} }));

    expect(output.errors).toEqual([]);
    expect(output.caseUpdates.currentStepKey).toBe('itFulfilment');
  });
});

describe('decisions', () => {
  const atManager = caseState({ status: 'active', currentStepKey: 'managerApproval' });

  it('completes the case when IT fulfils it', () => {
    const output = advance(
      input({
        caseState: caseState({ status: 'active', currentStepKey: 'itFulfilment' }),
        event: { type: 'taskDecided', taskId: 'task-3', decision: 'complete' },
      }),
    );

    expect(output.caseUpdates.status).toBe('completed');
    expect(output.caseUpdates.outcome).toBe('approved');
    expect(output.caseUpdates.currentStepKey).toBeNull();
    expect(output.tasksToCreate).toEqual([]);
    expect(output.eventsToEmit.map((event) => event.eventType)).toContain('case.completed');
  });

  it('rejects the case, with the comment the step requires', () => {
    const output = advance(
      input({
        caseState: atManager,
        event: {
          type: 'taskDecided',
          taskId: 'task-1',
          decision: 'reject',
          comment: 'Not budgeted this quarter.',
        },
      }),
    );

    expect(output.errors).toEqual([]);
    expect(output.caseUpdates.status).toBe('rejected');
    expect(output.caseUpdates.outcome).toBe('rejected');
    expect(output.eventsToEmit.map((event) => event.eventType)).toContain('case.rejected');
  });

  it('refuses a decision that the step requires a comment for when none is given', () => {
    const output = advance(
      input({
        caseState: atManager,
        event: { type: 'taskDecided', taskId: 'task-1', decision: 'reject' },
      }),
    );

    expect(output.errors[0]?.code).toBe('commentRequired');
    expect(output.caseUpdates.status).toBeUndefined();
  });

  it('treats whitespace as no comment at all', () => {
    const output = advance(
      input({
        caseState: atManager,
        event: { type: 'taskDecided', taskId: 'task-1', decision: 'reject', comment: '   ' },
      }),
    );

    expect(output.errors[0]?.code).toBe('commentRequired');
  });

  it('refuses a decision the step does not allow', () => {
    const output = advance(
      input({
        caseState: caseState({ status: 'active', currentStepKey: 'itFulfilment' }),
        event: { type: 'taskDecided', taskId: 'task-3', decision: 'approve' },
      }),
    );

    expect(output.errors[0]?.code).toBe('decisionNotAllowed');
  });

  it('returns the case to the requester with a task to amend it', () => {
    const output = advance(
      input({
        caseState: atManager,
        event: {
          type: 'taskDecided',
          taskId: 'task-1',
          decision: 'return',
          comment: 'Please add a quote.',
        },
      }),
    );

    expect(output.caseUpdates.status).toBe('active');
    expect(output.caseUpdates.currentStepKey).toBeNull();
    expect(output.tasksToCreate[0]).toMatchObject({
      stepKey: '$returnedToRequester',
      assigneeUserId: SUBMITTER,
    });
    expect(output.eventsToEmit.map((event) => event.eventType)).toContain('case.returned');
  });

  it('refuses to advance a case that has already finished', () => {
    for (const status of ['completed', 'rejected', 'cancelled'] as const) {
      const output = advance(
        input({
          caseState: caseState({ status, currentStepKey: null }),
          event: { type: 'taskDecided', taskId: 'task-1', decision: 'approve' },
        }),
      );
      expect(output.errors[0]?.code).toBe('caseAlreadyTerminal');
    }
  });
});

describe('malformed definitions produce errors, never crashes', () => {
  it('sends the case to unassigned when no branch matches and there is no default', () => {
    const steps: WorkflowStep[] = [
      {
        key: 'start',
        name: 'Start',
        type: 'approval',
        assignment: { strategy: 'submitter' },
        allowedDecisions: ['approve'],
        transitions: {
          // Every branch is conditional; PRD.md §5.4 requires a `when: null`
          // default last, and this definition has none.
          approve: [{ when: { field: 'never', operator: 'isTrue' }, to: '$completed' }],
        },
      },
    ];

    const output = advance(
      input({
        definition: definition(steps),
        caseState: caseState({ status: 'active', currentStepKey: 'start' }),
        event: { type: 'taskDecided', taskId: 'task-1', decision: 'approve' },
      }),
    );

    expect(output.caseUpdates.status).toBe('unassigned');
    expect(output.errors[0]?.code).toBe('noMatchingTransition');
  });

  it('reports a transition pointing at a step that does not exist', () => {
    const steps: WorkflowStep[] = [
      {
        key: 'start',
        name: 'Start',
        type: 'approval',
        assignment: { strategy: 'submitter' },
        allowedDecisions: ['approve'],
        transitions: { approve: [{ when: null, to: 'doesNotExist' }] },
      },
    ];

    const output = advance(
      input({
        definition: definition(steps),
        caseState: caseState({ status: 'active', currentStepKey: 'start' }),
        event: { type: 'taskDecided', taskId: 'task-1', decision: 'approve' },
      }),
    );

    expect(output.caseUpdates.status).toBe('unassigned');
    expect(output.errors[0]?.code).toBe('unknownStep');
  });

  it('stops a runaway automatic-step loop at the guard rather than hanging', () => {
    // PRD.md §6.3 step 7: a maximum of 20 automatic steps per advance.
    const steps: WorkflowStep[] = [
      {
        key: 'loopA',
        name: 'Loop A',
        type: 'automatic',
        assignment: { strategy: 'submitter' },
        allowedDecisions: ['complete'],
        transitions: { complete: [{ when: null, to: 'loopB' }] },
      },
      {
        key: 'loopB',
        name: 'Loop B',
        type: 'automatic',
        assignment: { strategy: 'submitter' },
        allowedDecisions: ['complete'],
        transitions: { complete: [{ when: null, to: 'loopA' }] },
      },
    ];

    const output = advance(input({ definition: definition(steps) }));

    expect(output.caseUpdates.status).toBe('unassigned');
    expect(output.errors.at(-1)?.code).toBe('automaticStepLimitExceeded');
  });

  it('runs automatic steps through to a terminal state without creating tasks', () => {
    const steps: WorkflowStep[] = [
      {
        key: 'autoRoute',
        name: 'Automatic routing',
        type: 'automatic',
        assignment: { strategy: 'submitter' },
        allowedDecisions: ['complete'],
        transitions: { complete: [{ when: null, to: '$completed' }] },
      },
    ];

    const output = advance(input({ definition: definition(steps) }));

    expect(output.errors).toEqual([]);
    expect(output.caseUpdates.status).toBe('completed');
    expect(output.tasksToCreate).toEqual([]);
  });
});

describe('other lifecycle events', () => {
  it('cancels an active case', () => {
    const output = advance(
      input({
        caseState: caseState({ status: 'active', currentStepKey: 'managerApproval' }),
        event: { type: 'caseCancelled', reason: 'No longer needed.' },
      }),
    );

    expect(output.caseUpdates.status).toBe('cancelled');
    expect(output.caseUpdates.outcome).toBe('cancelled');
    expect(output.caseUpdates.currentStepKey).toBeNull();
    expect(output.eventsToEmit.map((event) => event.eventType)).toContain('case.cancelled');
    expect(output.transitions[0]).toMatchObject({
      fromStepKey: 'managerApproval',
      toStepKey: '$cancelled',
      triggerType: 'admin',
    });
  });

  it('restarts a returned case from the beginning when it is resubmitted', () => {
    const output = advance(
      input({
        caseState: caseState({ status: 'active', currentStepKey: null }),
        event: { type: 'caseResubmitted' },
      }),
    );

    expect(output.errors).toEqual([]);
    expect(output.caseUpdates.currentStepKey).toBe('managerApproval');
    expect(output.eventsToEmit.map((event) => event.eventType)).toContain('case.resubmitted');
  });

  it('reports a decision arriving when the case has no current step', () => {
    const output = advance(
      input({
        caseState: caseState({ status: 'active', currentStepKey: null }),
        event: { type: 'taskDecided', taskId: 'task-1', decision: 'approve' },
      }),
    );

    expect(output.errors[0]?.code).toBe('noCurrentStep');
  });

  it('reports a decision against a step missing from the pinned version', () => {
    const output = advance(
      input({
        caseState: caseState({ status: 'active', currentStepKey: 'goneAway' }),
        event: { type: 'taskDecided', taskId: 'task-1', decision: 'approve' },
      }),
    );

    expect(output.errors[0]?.code).toBe('unknownStep');
  });

  it('reports a step that allows a decision but defines no transition for it', () => {
    const steps: WorkflowStep[] = [
      {
        key: 'start',
        name: 'Start',
        type: 'approval',
        assignment: { strategy: 'submitter' },
        allowedDecisions: ['approve'],
        transitions: {},
      },
    ];

    const output = advance(
      input({
        definition: definition(steps),
        caseState: caseState({ status: 'active', currentStepKey: 'start' }),
        event: { type: 'taskDecided', taskId: 'task-1', decision: 'approve' },
      }),
    );

    expect(output.errors[0]?.code).toBe('noTransitionForDecision');
    expect(output.caseUpdates.status).toBe('unassigned');
  });

  it('reports taskExpired as belonging to a later phase rather than ignoring it', () => {
    const output = advance(
      input({
        caseState: caseState({ status: 'active', currentStepKey: 'managerApproval' }),
        event: { type: 'taskExpired', taskId: 'task-1' },
      }),
    );
    expect(output.errors[0]?.code).toBe('eventNotImplemented');
  });

  it('flags a step with no escalation configured as exhausted rather than not implemented', () => {
    // managerApproval in this fixture carries no sla.escalation, so the
    // very first level already has nothing to try: a real outcome
    // (escalationTriggered is implemented), not a stand-in for
    // "unsupported". See escalation.test.ts for a step that does configure
    // escalation levels.
    const output = advance(
      input({
        caseState: caseState({ status: 'active', currentStepKey: 'managerApproval' }),
        event: { type: 'escalationTriggered', taskId: 'task-1' },
      }),
    );
    expect(output.errors[0]?.code).toBe('escalationLevelsExhausted');
    expect(output.caseUpdates.status).toBe('unassigned');
  });

  it('reports an unrecognised event instead of throwing', () => {
    const output = advance(
      input({
        caseState: caseState({ status: 'active', currentStepKey: 'managerApproval' }),
        event: { type: 'telepathy' } as unknown as EngineInput['event'],
      }),
    );

    expect(output.errors[0]?.code).toBe('unknownEvent');
  });
});

describe('unassigned is recorded, not silent (PRD.md §6.4)', () => {
  const noLineManager = context({
    submitter: {
      userId: SUBMITTER,
      department: 'Engineering',
      roles: ['member'],
      lineManagerUserId: null,
    },
  });

  it('records a transition when a case falls into unassigned', () => {
    // "Every state change produces a transition record. There are no silent
    // transitions." Landing in unassigned is a state change, so the
    // timeline must not simply stop with no explanation.
    const output = advance(input({ context: noLineManager }));

    expect(output.caseUpdates.status).toBe('unassigned');
    expect(output.transitions).toHaveLength(1);
    expect(output.transitions[0]).toMatchObject({
      fromStepKey: null,
      toStepKey: 'managerApproval',
      triggerType: 'submission',
    });
    expect(output.transitions[0]?.conditionResult).toMatchObject({
      unassignedReason: 'assignmentUnresolved',
    });
  });

  it('records a transition when a definition points at a step that does not exist', () => {
    const steps: WorkflowStep[] = [
      {
        key: 'start',
        name: 'Start',
        type: 'approval',
        assignment: { strategy: 'submitter' },
        allowedDecisions: ['approve'],
        transitions: { approve: [{ when: null, to: 'doesNotExist' }] },
      },
    ];

    const output = advance(
      input({
        definition: definition(steps),
        caseState: caseState({ status: 'active', currentStepKey: 'start' }),
        event: { type: 'taskDecided', taskId: 'task-1', decision: 'approve' },
      }),
    );

    const unassignedTransition = output.transitions.find(
      (transition) => transition.conditionResult?.unassignedReason === 'unknownStep',
    );
    expect(unassignedTransition).toBeDefined();
  });

  it('records a transition when the automatic-step guard trips', () => {
    const steps: WorkflowStep[] = [
      {
        key: 'loopA',
        name: 'Loop A',
        type: 'automatic',
        assignment: { strategy: 'submitter' },
        allowedDecisions: ['complete'],
        transitions: { complete: [{ when: null, to: 'loopB' }] },
      },
      {
        key: 'loopB',
        name: 'Loop B',
        type: 'automatic',
        assignment: { strategy: 'submitter' },
        allowedDecisions: ['complete'],
        transitions: { complete: [{ when: null, to: 'loopA' }] },
      },
    ];

    const output = advance(input({ definition: definition(steps) }));

    const guardTransition = output.transitions.find(
      (transition) => transition.conditionResult?.unassignedReason === 'automaticStepLimitExceeded',
    );
    expect(guardTransition).toBeDefined();
  });

  it('records a transition when an automatic step cannot route onward', () => {
    const steps: WorkflowStep[] = [
      {
        key: 'autoStuck',
        name: 'Stuck automatic step',
        type: 'automatic',
        assignment: { strategy: 'submitter' },
        allowedDecisions: ['complete'],
        // No `complete` key, so the automatic step has nowhere to go.
        transitions: { somethingElse: [{ when: null, to: '$completed' }] },
      },
    ];

    const output = advance(input({ definition: definition(steps) }));

    expect(output.caseUpdates.status).toBe('unassigned');
    expect(output.errors.map((error) => error.code)).toContain('noTransitionForDecision');
    expect(output.errors.map((error) => error.code)).toContain('automaticStepStalled');
  });

  it('records a transition when a decision cannot be routed', () => {
    const steps: WorkflowStep[] = [
      {
        key: 'start',
        name: 'Start',
        type: 'approval',
        assignment: { strategy: 'submitter' },
        allowedDecisions: ['approve'],
        transitions: {
          approve: [{ when: { field: 'never', operator: 'isTrue' }, to: '$completed' }],
        },
      },
    ];

    const output = advance(
      input({
        definition: definition(steps),
        caseState: caseState({ status: 'active', currentStepKey: 'start' }),
        event: { type: 'taskDecided', taskId: 'task-1', decision: 'approve' },
      }),
    );

    expect(output.caseUpdates.status).toBe('unassigned');
    expect(output.transitions.at(-1)?.conditionResult).toMatchObject({
      unassignedReason: 'transitionSelectionFailed',
    });
  });
});

describe('resubmission guards', () => {
  it('refuses to resubmit a case that is sitting on an open step', () => {
    const output = advance(
      input({
        caseState: caseState({ status: 'active', currentStepKey: 'managerApproval' }),
        event: { type: 'caseResubmitted' },
      }),
    );

    expect(output.errors[0]?.code).toBe('caseNotReturned');
    expect(output.tasksToCreate).toEqual([]);
  });

  it('refuses to resubmit a draft that was never submitted', () => {
    const output = advance(
      input({
        caseState: caseState({ status: 'draft', currentStepKey: null }),
        event: { type: 'caseResubmitted' },
      }),
    );

    expect(output.errors[0]?.code).toBe('caseNotReturned');
  });
});

describe('engine invariants (PRD.md §6.4)', () => {
  it('is deterministic: the same input produces the same output', () => {
    expect(advance(input())).toEqual(advance(input()));
  });

  it('never mutates its inputs', () => {
    const original = input();
    const snapshot = structuredClone(original);

    advance(original);

    expect(original).toEqual(snapshot);
  });

  it('takes its clock from context rather than reading the real one', () => {
    const output = advance(input({ context: context({ now: '2030-01-01T00:00:00.000Z' }) }));

    expect(output.eventsToEmit[0]?.occurredAt).toBe('2030-01-01T00:00:00.000Z');
    // Midnight on Tuesday 1 January is before the working day opens, so the
    // 48 working hours start at 09:00 and run out at closing time on
    // Tuesday the 8th, a weekend in between.
    expect(output.tasksToCreate[0]?.dueAt).toBe('2030-01-08T17:00:00.000Z');
  });

  it('gives every emitted event the correlation id it was handed', () => {
    const output = advance(input({ context: context({ correlationId: 'abc-123' }) }));

    expect(output.eventsToEmit.length).toBeGreaterThan(0);
    for (const event of output.eventsToEmit) {
      expect(event.correlationId).toBe('abc-123');
      expect(event.organisationId).toBe('00000000-0000-0000-0000-0000000000ff');
    }
  });

  it('gives every event within one advance a distinct id', () => {
    const output = advance(input());
    const ids = output.eventsToEmit.map((event) => event.eventId);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('produces a transition for every state change, with no silent transitions', () => {
    const output = advance(input());
    expect(output.transitions.length).toBeGreaterThan(0);
  });
});

describe('the full Laptop Request journey', () => {
  it('runs submit, manager approval, finance approval and fulfilment to completion', () => {
    const values = { laptopModel: 'mbp16', estimatedCost: 2400 };

    const submitted = advance(input({ values }));
    expect(submitted.caseUpdates.currentStepKey).toBe('managerApproval');

    const afterManager = advance(
      input({
        values,
        caseState: caseState({ status: 'active', currentStepKey: 'managerApproval' }),
        event: { type: 'taskDecided', taskId: 'task-1', decision: 'approve' },
      }),
    );
    expect(afterManager.caseUpdates.currentStepKey).toBe('financeApproval');

    const afterFinance = advance(
      input({
        values,
        caseState: caseState({ status: 'active', currentStepKey: 'financeApproval' }),
        event: { type: 'taskDecided', taskId: 'task-2', decision: 'approve' },
      }),
    );
    expect(afterFinance.caseUpdates.currentStepKey).toBe('itFulfilment');

    const afterIt = advance(
      input({
        values,
        caseState: caseState({ status: 'active', currentStepKey: 'itFulfilment' }),
        event: { type: 'taskDecided', taskId: 'task-3', decision: 'complete' },
      }),
    );
    expect(afterIt.caseUpdates.status).toBe('completed');
    expect(afterIt.caseUpdates.outcome).toBe('approved');
  });

  it('runs the two-step path when the cost is under the threshold', () => {
    const values = { laptopModel: 'mbp14', estimatedCost: 900 };

    const afterManager = advance(
      input({
        values,
        caseState: caseState({ status: 'active', currentStepKey: 'managerApproval' }),
        event: { type: 'taskDecided', taskId: 'task-1', decision: 'approve' },
      }),
    );
    expect(afterManager.caseUpdates.currentStepKey).toBe('itFulfilment');

    const afterIt = advance(
      input({
        values,
        caseState: caseState({ status: 'active', currentStepKey: 'itFulfilment' }),
        event: { type: 'taskDecided', taskId: 'task-3', decision: 'complete' },
      }),
    );
    expect(afterIt.caseUpdates.status).toBe('completed');
  });
});
