import type { WorkflowStep } from '@orgflow/types';
import { describe, expect, it } from 'vitest';

import {
  addEscalationRule,
  addReminder,
  addTransitionRule,
  moveEscalationRule,
  moveStep,
  moveTransitionRule,
  removeEscalationRule,
  removeReminder,
  removeTransitionRule,
  stepKeyFrom,
  updateEscalationRule,
  updateReminder,
  updateTransitionRule,
} from './document-ops';

function step(key: string): WorkflowStep {
  return {
    key,
    name: key,
    type: 'approval',
    assignment: { strategy: 'lineManager' },
    allowedDecisions: ['approve', 'reject'],
    transitions: {
      approve: [{ when: null, to: '$completed' }],
    },
  };
}

function stepWithSla(key: string): WorkflowStep & { sla: NonNullable<WorkflowStep['sla']> } {
  return { ...step(key), sla: { durationHours: 48 } };
}

describe('moveStep', () => {
  it('swaps a step one place towards the end', () => {
    const steps = [step('a'), step('b'), step('c')];
    const moved = moveStep(steps, 'a', 1);
    expect(moved.map((s) => s.key)).toEqual(['b', 'a', 'c']);
  });

  it('does nothing at the boundary', () => {
    const steps = [step('a'), step('b')];
    expect(moveStep(steps, 'a', -1)).toBe(steps);
  });
});

describe('transition rule operations', () => {
  it('appends a new rule to the end of a decision', () => {
    const s = addTransitionRule(step('a'), 'approve', {
      when: { field: 'cost', operator: 'gt', value: 1000 },
      to: 'financeApproval',
    });
    expect(s.transitions.approve).toEqual([
      { when: { field: 'cost', operator: 'gt', value: 1000 }, to: 'financeApproval' },
      { when: null, to: '$completed' },
    ]);
  });

  it('removes a rule by index', () => {
    const withTwo = addTransitionRule(step('a'), 'approve', { when: null, to: 'itFulfilment' });
    const removed = removeTransitionRule(withTwo, 'approve', 0);
    expect(removed.transitions.approve).toEqual([{ when: null, to: 'itFulfilment' }]);
  });

  it('replaces a rule in place', () => {
    const s = updateTransitionRule(step('a'), 'approve', 0, { when: null, to: 'somewhereElse' });
    expect(s.transitions.approve).toEqual([{ when: null, to: 'somewhereElse' }]);
  });

  it('reorders rules, where order changes which one wins first-match', () => {
    const withTwo = addTransitionRule(step('a'), 'approve', { when: null, to: 'second' });
    const moved = moveTransitionRule(withTwo, 'approve', 1, -1);
    expect(moved.transitions.approve!.map((r) => r.to)).toEqual(['second', '$completed']);
  });
});

describe('reminder operations', () => {
  it('appends a reminder', () => {
    const s = addReminder(stepWithSla('a'), { atHoursBefore: 12 });
    expect(s.sla.reminders).toEqual([{ atHoursBefore: 12 }]);
  });

  it('replaces a reminder in place', () => {
    const withOne = addReminder(stepWithSla('a'), { atHoursBefore: 12 });
    const updated = updateReminder(withOne, 0, { atHoursBefore: 6 });
    expect(updated.sla.reminders).toEqual([{ atHoursBefore: 6 }]);
  });

  it('removes a reminder by index', () => {
    const withTwo = addReminder(addReminder(stepWithSla('a'), { atHoursBefore: 12 }), {
      atHoursBefore: 6,
    });
    const removed = removeReminder(withTwo, 0);
    expect(removed.sla.reminders).toEqual([{ atHoursBefore: 6 }]);
  });
});

describe('escalation rule operations', () => {
  it('appends a rule', () => {
    const s = addEscalationRule(stepWithSla('a'), { strategy: 'lineManager', atHoursAfter: 24 });
    expect(s.sla.escalation).toEqual([{ strategy: 'lineManager', atHoursAfter: 24 }]);
  });

  it('replaces a rule in place', () => {
    const withOne = addEscalationRule(stepWithSla('a'), {
      strategy: 'lineManager',
      atHoursAfter: 24,
    });
    const updated = updateEscalationRule(withOne, 0, {
      strategy: 'role',
      role: 'processOwner',
      atHoursAfter: 24,
    });
    expect(updated.sla.escalation).toEqual([
      { strategy: 'role', role: 'processOwner', atHoursAfter: 24 },
    ]);
  });

  it('removes a rule by index', () => {
    const withTwo = addEscalationRule(
      addEscalationRule(stepWithSla('a'), { strategy: 'lineManager', atHoursAfter: 24 }),
      { strategy: 'role', role: 'processOwner', atHoursAfter: 72 },
    );
    const removed = removeEscalationRule(withTwo, 0);
    expect(removed.sla.escalation).toEqual([
      { strategy: 'role', role: 'processOwner', atHoursAfter: 72 },
    ]);
  });

  it('reorders rules, where order changes which level each one resolves at', () => {
    const withTwo = addEscalationRule(
      addEscalationRule(stepWithSla('a'), { strategy: 'lineManager', atHoursAfter: 24 }),
      { strategy: 'role', role: 'processOwner', atHoursAfter: 72 },
    );
    const moved = moveEscalationRule(withTwo, 1, -1);
    expect(moved.sla.escalation!.map((rule) => rule.strategy)).toEqual(['role', 'lineManager']);
  });

  it('does nothing at the boundary', () => {
    const withOne = addEscalationRule(stepWithSla('a'), {
      strategy: 'lineManager',
      atHoursAfter: 24,
    });
    expect(moveEscalationRule(withOne, 0, -1)).toBe(withOne);
  });
});

describe('stepKeyFrom', () => {
  it('slugifies a name into a valid, unique key', () => {
    expect(stepKeyFrom('Line Manager Approval', [])).toBe('line_manager_approval');
  });

  it('appends a numeric suffix on collision', () => {
    expect(stepKeyFrom('Approval', ['approval'])).toBe('approval_2');
  });
});
