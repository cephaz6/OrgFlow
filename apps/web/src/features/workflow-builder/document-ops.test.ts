import type { WorkflowStep } from '@orgflow/types';
import { describe, expect, it } from 'vitest';

import {
  addTransitionRule,
  moveStep,
  moveTransitionRule,
  removeTransitionRule,
  stepKeyFrom,
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

describe('stepKeyFrom', () => {
  it('slugifies a name into a valid, unique key', () => {
    expect(stepKeyFrom('Line Manager Approval', [])).toBe('line_manager_approval');
  });

  it('appends a numeric suffix on collision', () => {
    expect(stepKeyFrom('Approval', ['approval'])).toBe('approval_2');
  });
});
