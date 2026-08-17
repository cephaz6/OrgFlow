import type { WorkflowStep } from '@orgflow/types';
import { describe, expect, it } from 'vitest';

import { computeLayout } from './layout';

function approvalStep(key: string, to: string): WorkflowStep {
  return {
    key,
    name: key,
    type: 'approval',
    assignment: { strategy: 'lineManager' },
    allowedDecisions: ['approve'],
    transitions: { approve: [{ when: null, to }] },
  };
}

describe('computeLayout', () => {
  it('lays out a simple chain in increasing layers', () => {
    const steps = [approvalStep('a', 'b'), { ...approvalStep('b', '$completed') }];
    const { nodes } = computeLayout(steps, 'a');
    expect(nodes.find((n) => n.key === 'a')!.layer).toBe(0);
    expect(nodes.find((n) => n.key === 'b')!.layer).toBe(1);
    expect(nodes.find((n) => n.key === '$completed')!.layer).toBe(2);
  });

  it('marks a step unreached from the start as unreachable, in a later layer', () => {
    const steps = [approvalStep('a', '$completed'), approvalStep('orphan', '$completed')];
    const { nodes } = computeLayout(steps, 'a');
    const orphan = nodes.find((n) => n.key === 'orphan')!;
    expect(orphan.reachable).toBe(false);
    const start = nodes.find((n) => n.key === 'a')!;
    expect(orphan.layer).toBeGreaterThan(start.layer);
  });

  it('terminates on a cycle instead of looping forever', () => {
    const steps: WorkflowStep[] = [{ ...approvalStep('a', 'b') }, { ...approvalStep('b', 'a') }];
    const { nodes } = computeLayout(steps, 'a');
    expect(nodes.length).toBeGreaterThan(0);
  });

  it('produces one edge per transition rule', () => {
    const steps = [approvalStep('a', '$completed')];
    const { edges } = computeLayout(steps, 'a');
    expect(edges).toEqual([
      {
        id: 'a:approve:0',
        from: 'a',
        to: '$completed',
        decision: 'approve',
        ruleIndex: 0,
        isDefault: true,
      },
    ]);
  });
});
