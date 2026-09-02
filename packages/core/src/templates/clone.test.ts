import type { TemplateBlueprint, WorkflowStep } from '@orgflow/types';
import { describe, expect, it } from 'vitest';

import { cloneTemplate, uniqueKey } from './clone.js';

const ORGANISATION = '00000000-0000-4000-8000-0000000000ff';
const DEFINITION = '00000000-0000-4000-8000-0000000000ee';
const USER = '00000000-0000-4000-8000-000000000001';
const SOMEONE_ELSE = '00000000-0000-4000-8000-00000000dead';
const NOW = '2026-09-02T09:00:00.000Z';

function step(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    key: 'approval',
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

function blueprint(steps: WorkflowStep[] = [step()]): TemplateBlueprint {
  return {
    key: 'laptop-request',
    name: 'Laptop request',
    form: { titleFieldKey: 'model', sections: [] },
    workflow: { startStepKey: steps[0]!.key, steps },
  };
}

function cloneOf(steps?: WorkflowStep[], existingKeys: string[] = []) {
  return cloneTemplate({
    blueprint: blueprint(steps),
    organisationId: ORGANISATION,
    definitionId: DEFINITION,
    existingKeys,
    createdByUserId: USER,
    now: NOW,
  });
}

describe('uniqueKey', () => {
  it('keeps the key when nothing else uses it', () => {
    expect(uniqueKey('laptop-request', [])).toBe('laptop-request');
  });

  it('suffixes on collision, and keeps suffixing', () => {
    expect(uniqueKey('laptop-request', ['laptop-request'])).toBe('laptop-request_2');
    expect(uniqueKey('laptop-request', ['laptop-request', 'laptop-request_2'])).toBe(
      'laptop-request_3',
    );
  });
});

describe('cloneTemplate', () => {
  it('takes on the cloning organisation, a fresh definition and version 1', () => {
    const { document } = cloneOf();

    expect(document.organisationId).toBe(ORGANISATION);
    expect(document.definitionId).toBe(DEFINITION);
    expect(document.versionNumber).toBe(1);
    expect(document.createdByUserId).toBe(USER);
    expect(document.createdAt).toBe(NOW);
  });

  it('is a hard copy, carrying no reference back to the template', () => {
    // PRD.md §9.2: no templateId is retained, so a later template edit can
    // never reach this definition. Asserted on the document itself rather
    // than trusted, because the whole guarantee rests on the absence.
    const { document } = cloneOf();
    expect(JSON.stringify(document)).not.toContain('templateId');
  });

  it('regenerates a key the target organisation is already using', () => {
    const { document } = cloneOf(undefined, ['laptop-request']);
    expect(document.key).toBe('laptop-request_2');
  });

  it('leaves a key alone when nothing collides', () => {
    const { document } = cloneOf(undefined, ['something-else']);
    expect(document.key).toBe('laptop-request');
  });

  it('resets a step assigned to a specific user, and says so', () => {
    const { document, warnings } = cloneOf([
      step({ assignment: { strategy: 'specificUser', userId: SOMEONE_ELSE } }),
    ]);

    expect(document.workflow.steps[0]!.assignment).toEqual({ strategy: 'lineManager' });
    expect(warnings).toEqual([
      {
        stepKey: 'approval',
        stepName: 'Manager approval',
        original: SOMEONE_ELSE,
        reason: 'specificUser',
      },
    ]);
  });

  it('resets a step assigned to a group, naming the group it pointed at', () => {
    const { document, warnings } = cloneOf([
      step({ assignment: { strategy: 'group', groupKey: 'itSupport' } }),
    ]);

    expect(document.workflow.steps[0]!.assignment).toEqual({ strategy: 'lineManager' });
    expect(warnings[0]).toMatchObject({ original: 'itSupport', reason: 'group' });
  });

  it('leaves a strategy that means the same thing in any organisation alone', () => {
    // lineManager, submitter and role are all resolved against the cloning
    // organisation's own directory, so they need no reconfiguration.
    const { document, warnings } = cloneOf([
      step({ key: 'a', assignment: { strategy: 'lineManager' } }),
      step({ key: 'b', assignment: { strategy: 'submitter' } }),
      step({ key: 'c', assignment: { strategy: 'role', role: 'approver' } }),
    ]);

    expect(warnings).toEqual([]);
    expect(document.workflow.steps.map((s) => s.assignment.strategy)).toEqual([
      'lineManager',
      'submitter',
      'role',
    ]);
  });

  it('resets an escalation level that names a group, keeping its timing', () => {
    const { document, warnings } = cloneOf([
      step({
        sla: {
          durationHours: 48,
          escalation: [
            { strategy: 'group', groupKey: 'security', atHoursAfter: 24 },
            { strategy: 'role', role: 'admin', atHoursAfter: 72 },
          ],
        },
      }),
    ]);

    const escalation = document.workflow.steps[0]!.sla!.escalation!;
    expect(escalation[0]).toEqual({ strategy: 'lineManager', atHoursAfter: 24 });
    // The level that resolves anywhere is untouched, timing included.
    expect(escalation[1]).toEqual({ strategy: 'role', role: 'admin', atHoursAfter: 72 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ original: 'security', reason: 'group' });
  });

  it('preserves the SLA of a step whose escalation needed nothing reset', () => {
    const { document } = cloneOf([
      step({
        sla: { durationHours: 24, businessHoursOnly: false, reminders: [{ atHoursBefore: 4 }] },
      }),
    ]);

    expect(document.workflow.steps[0]!.sla).toEqual({
      durationHours: 24,
      businessHoursOnly: false,
      reminders: [{ atHoursBefore: 4 }],
    });
  });

  it('reports one warning per offending step, across the whole workflow', () => {
    const { warnings } = cloneOf([
      step({ key: 'a', name: 'A', assignment: { strategy: 'group', groupKey: 'finance' } }),
      step({ key: 'b', name: 'B', assignment: { strategy: 'lineManager' } }),
      step({ key: 'c', name: 'C', assignment: { strategy: 'specificUser', userId: SOMEONE_ELSE } }),
    ]);

    expect(warnings.map((warning) => warning.stepKey)).toEqual(['a', 'c']);
  });

  it('does not mutate the blueprint it was given', () => {
    const original = blueprint([
      step({ assignment: { strategy: 'group', groupKey: 'itSupport' } }),
    ]);
    const snapshot = JSON.parse(JSON.stringify(original)) as unknown;

    cloneTemplate({
      blueprint: original,
      organisationId: ORGANISATION,
      definitionId: DEFINITION,
      existingKeys: [],
      createdByUserId: USER,
      now: NOW,
    });

    // A template is cloned many times; a transform that quietly rewrote the
    // blueprint would corrupt every clone after the first.
    expect(JSON.parse(JSON.stringify(original))).toEqual(snapshot);
  });
});
