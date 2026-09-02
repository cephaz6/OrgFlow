import { advance } from '@orgflow/core';
import type {
  CaseState,
  EvaluationContext,
  ProcessDefinitionDocument,
  WorkflowDecisionAction,
} from '@orgflow/types';
import { describe, expect, it } from 'vitest';

import { SYSTEM_TEMPLATES } from './system-templates.js';

// PRD.md Phase 5's acceptance criterion is "all six system templates
// publish and run". Running them is the half a type check cannot give, so
// each blueprint here is driven through the real engine to a terminal
// outcome, approving at every step. A template that cannot reach an
// outcome fails this file rather than being discovered by whoever clones
// it first.

const ORGANISATION = '00000000-0000-4000-8000-0000000000ff';
const SUBMITTER = '00000000-0000-4000-8000-000000000001';
const LINE_MANAGER = '00000000-0000-4000-8000-000000000002';

function documentFor(blueprint: (typeof SYSTEM_TEMPLATES)[number]): ProcessDefinitionDocument {
  return {
    ...blueprint.blueprint,
    organisationId: ORGANISATION,
    definitionId: '00000000-0000-4000-8000-0000000000ee',
    versionNumber: 1,
    createdByUserId: SUBMITTER,
    createdAt: '2026-09-02T09:00:00.000Z',
  };
}

// Every group key any of the six mentions resolves, so a step failing to
// resolve means the workflow is wrong rather than the fixture being thin.
function contextFor(definition: ProcessDefinitionDocument): EvaluationContext {
  const groupIdsByKey: Record<string, string> = {};
  let counter = 1;
  for (const step of definition.workflow.steps) {
    if (step.assignment.strategy === 'group') {
      groupIdsByKey[step.assignment.groupKey] ??=
        `00000000-0000-4000-8000-b${String(counter++).padStart(11, '0')}`;
    }
  }

  return {
    now: '2026-09-02T09:00:00.000Z',
    correlationId: 'system-template-check',
    submitter: {
      userId: SUBMITTER,
      department: 'Engineering',
      roles: ['member', 'approver', 'admin'],
      lineManagerUserId: LINE_MANAGER,
    },
    case: { daysOpen: 0 },
    step: { escalationLevel: 0 },
    directory: { groupIdsByKey, activeDelegateByUserId: {} },
  };
}

// Submits, then takes the most positive decision available at each step
// until the case reaches a terminal status. Capped, so a definition that
// loops fails loudly here rather than hanging the suite.
function runToCompletion(
  definition: ProcessDefinitionDocument,
  values: Record<string, unknown>,
): { status: string; visited: string[] } {
  const context = contextFor(definition);
  let caseState: CaseState = {
    caseId: '00000000-0000-4000-8000-0000000000dd',
    definitionId: definition.definitionId,
    versionId: '00000000-0000-4000-8000-0000000000cc',
    status: 'draft',
    outcome: null,
    currentStepKey: null,
  };

  const visited: string[] = [];
  let output = advance({
    definition,
    caseState,
    values,
    event: { type: 'caseSubmitted' },
    context,
  });
  expect(output.errors, `${definition.key} failed to submit`).toEqual([]);
  caseState = { ...caseState, ...output.caseUpdates };

  for (let guard = 0; guard < 20; guard += 1) {
    if (caseState.status !== 'active') {
      return { status: caseState.status, visited };
    }

    const step = definition.workflow.steps.find(
      (candidate) => candidate.key === caseState.currentStepKey,
    );
    expect(step, `${definition.key} sat on an unknown step`).toBeDefined();
    visited.push(step!.key);

    const decision: WorkflowDecisionAction = step!.allowedDecisions.includes('approve')
      ? 'approve'
      : 'complete';

    output = advance({
      definition,
      caseState,
      values,
      event: { type: 'taskDecided', taskId: `task-${guard}`, decision },
      context,
    });
    expect(output.errors, `${definition.key} errored on ${step!.key}`).toEqual([]);
    caseState = { ...caseState, ...output.caseUpdates };
  }

  throw new Error(`${definition.key} did not reach a terminal state`);
}

describe('the system template catalogue', () => {
  it('has the six PRD.md §9.3 names in it', () => {
    expect(SYSTEM_TEMPLATES).toHaveLength(6);
  });

  it('uses a unique key per template, since the registry is unique on it', () => {
    const keys = SYSTEM_TEMPLATES.map((template) => template.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(SYSTEM_TEMPLATES.map((template) => [template.key, template] as const))(
    '%s starts at a real step and titles itself from a real field',
    (_key, template) => {
      const { form, workflow } = template.blueprint;
      const stepKeys = workflow.steps.map((step) => step.key);
      expect(stepKeys).toContain(workflow.startStepKey);

      const fieldKeys = form.sections.flatMap((s) => s.fields.map((field) => field.key));
      expect(fieldKeys).toContain(form.titleFieldKey);
    },
  );

  it.each(SYSTEM_TEMPLATES.map((template) => [template.key, template] as const))(
    '%s routes every decision it allows to somewhere that exists',
    (_key, template) => {
      const stepKeys = new Set(template.blueprint.workflow.steps.map((step) => step.key));
      const terminals = new Set(['$completed', '$rejected', '$cancelled', '$returnedToRequester']);

      for (const step of template.blueprint.workflow.steps) {
        for (const decision of step.allowedDecisions) {
          const rules = step.transitions[decision] ?? [];
          expect(rules.length, `${step.key} has no transition for ${decision}`).toBeGreaterThan(0);
          // A trailing default, so nothing can get stuck when no condition
          // matches (the warning apps/web's validateWorkflow raises).
          expect(rules[rules.length - 1]!.when).toBeNull();
          for (const rule of rules) {
            expect(stepKeys.has(rule.to) || terminals.has(rule.to)).toBe(true);
          }
        }
      }
    },
  );

  it.each(SYSTEM_TEMPLATES.map((template) => [template.key, template] as const))(
    '%s runs from submission to a terminal outcome',
    (_key, template) => {
      const { status } = runToCompletion(documentFor(template), {});
      expect(status).toBe('completed');
    },
  );

  it('sends a large expense claim through the director before finance', () => {
    // The one template whose behaviour depends on first-match-wins
    // ordering, asserted directly rather than only reached.
    const expense = SYSTEM_TEMPLATES.find((template) => template.key === 'expense-claim')!;
    const big = runToCompletion(documentFor(expense), { amount: 6000 });
    expect(big.visited).toEqual(['managerApproval', 'directorApproval', 'financeApproval']);

    const middling = runToCompletion(documentFor(expense), { amount: 900 });
    expect(middling.visited).toEqual(['managerApproval', 'financeApproval']);

    const small = runToCompletion(documentFor(expense), { amount: 20 });
    expect(small.visited).toEqual(['managerApproval']);
  });

  it('sends an expensive equipment request through finance and a cheap one straight out', () => {
    const equipment = SYSTEM_TEMPLATES.find((template) => template.key === 'equipment-request')!;
    expect(runToCompletion(documentFor(equipment), { cost: 2400 }).visited).toEqual([
      'managerApproval',
      'financeApproval',
    ]);
    expect(runToCompletion(documentFor(equipment), { cost: 300 }).visited).toEqual([
      'managerApproval',
    ]);
  });

  it('walks onboarding through all four teams in order', () => {
    const onboarding = SYSTEM_TEMPLATES.find(
      (template) => template.key === 'new-starter-onboarding',
    )!;
    expect(runToCompletion(documentFor(onboarding), {}).visited).toEqual([
      'hrSetup',
      'itSetup',
      'facilitiesSetup',
      'payrollSetup',
    ]);
  });

  it('schedules the policy exception escalation chain it configures', () => {
    const policy = SYSTEM_TEMPLATES.find((template) => template.key === 'policy-exception')!;
    const definition = documentFor(policy);
    const output = advance({
      definition,
      caseState: {
        caseId: '00000000-0000-4000-8000-0000000000dd',
        definitionId: definition.definitionId,
        versionId: '00000000-0000-4000-8000-0000000000cc',
        status: 'draft',
        outcome: null,
        currentStepKey: null,
      },
      values: {},
      event: { type: 'caseSubmitted' },
      context: contextFor(definition),
    });

    // One reminder and two escalation levels, the capability no other
    // template in the catalogue exercises.
    expect(output.timersToSchedule.map((timer) => timer.timerType)).toEqual([
      'reminder',
      'escalation',
      'escalation',
    ]);
  });
});
