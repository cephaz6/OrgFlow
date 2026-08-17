import type { ProcessDefinitionDocument, WorkflowStep } from '@orgflow/types';
import { describe, expect, it } from 'vitest';

import { hasBlockingIssues, validateWorkflow } from './validation';

function documentWith(
  workflow: ProcessDefinitionDocument['workflow'],
): Pick<ProcessDefinitionDocument, 'workflow'> {
  return { workflow };
}

function approvalStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    key: 'managerApproval',
    name: 'Manager approval',
    type: 'approval',
    assignment: { strategy: 'lineManager' },
    allowedDecisions: ['approve', 'reject'],
    transitions: {
      approve: [{ when: null, to: '$completed' }],
      reject: [{ when: null, to: '$rejected' }],
    },
    ...overrides,
  };
}

describe('validateWorkflow', () => {
  it('is silent on a well-formed single-step workflow', () => {
    const issues = validateWorkflow(
      documentWith({ startStepKey: 'managerApproval', steps: [approvalStep()] }),
    );
    expect(issues).toEqual([]);
  });

  it('blocks a start step that does not exist', () => {
    const issues = validateWorkflow(
      documentWith({ startStepKey: 'nowhere', steps: [approvalStep()] }),
    );
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it('blocks a step that allows a decision with no transition for it', () => {
    const issues = validateWorkflow(
      documentWith({
        startStepKey: 'managerApproval',
        steps: [approvalStep({ transitions: { approve: [{ when: null, to: '$completed' }] } })],
      }),
    );
    expect(hasBlockingIssues(issues)).toBe(true);
    expect(issues.some((issue) => issue.message.includes('"reject" but has no transition'))).toBe(
      true,
    );
  });

  it('warns, but does not block, a decision missing a default rule', () => {
    const issues = validateWorkflow(
      documentWith({
        startStepKey: 'managerApproval',
        steps: [
          approvalStep({
            allowedDecisions: ['approve'],
            transitions: {
              approve: [{ when: { field: 'cost', operator: 'gt', value: 1000 }, to: '$completed' }],
            },
          }),
        ],
      }),
    );
    expect(hasBlockingIssues(issues)).toBe(false);
    expect(issues.some((issue) => issue.message.includes('no default'))).toBe(true);
  });

  it('blocks a rule pointing at a step that does not exist', () => {
    const issues = validateWorkflow(
      documentWith({
        startStepKey: 'managerApproval',
        steps: [approvalStep({ transitions: { approve: [{ when: null, to: 'nowhere' }] } })],
      }),
    );
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it('warns about a step unreachable from the start', () => {
    const issues = validateWorkflow(
      documentWith({
        startStepKey: 'managerApproval',
        steps: [
          approvalStep(),
          approvalStep({
            key: 'orphanStep',
            name: 'Orphan step',
            allowedDecisions: ['approve'],
            transitions: { approve: [{ when: null, to: '$completed' }] },
          }),
        ],
      }),
    );
    expect(issues.some((issue) => issue.message.includes('cannot be reached'))).toBe(true);
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it('blocks duplicate step keys', () => {
    const issues = validateWorkflow(
      documentWith({
        startStepKey: 'managerApproval',
        steps: [approvalStep(), approvalStep({ name: 'Duplicate' })],
      }),
    );
    expect(hasBlockingIssues(issues)).toBe(true);
    expect(issues.some((issue) => issue.message.includes('share the key'))).toBe(true);
  });

  it('accepts a trivial bootstrap workflow with no steps', () => {
    const issues = validateWorkflow(documentWith({ startStepKey: '$completed', steps: [] }));
    expect(issues).toEqual([]);
  });
});
