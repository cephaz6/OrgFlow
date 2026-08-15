import type { AssignmentStrategy, EvaluationContext } from '@orgflow/types';
import { describe, expect, it } from 'vitest';

import { resolveAssignment, resolveAssignmentWithValues } from './assignment.js';
import { computeDueAt } from './sla.js';

const SUBMITTER = '00000000-0000-0000-0000-000000000001';
const LINE_MANAGER = '00000000-0000-0000-0000-000000000002';
const IT_GROUP_ID = '00000000-0000-0000-0000-0000000000aa';

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
    directory: { groupIdsByKey: { itSupport: IT_GROUP_ID } },
    ...overrides,
  };
}

describe('assignment resolution (PRD.md §7)', () => {
  it('resolves a named user', () => {
    const strategy: AssignmentStrategy = { strategy: 'specificUser', userId: 'user-9' };
    expect(resolveAssignment(strategy, context())).toMatchObject({
      resolved: true,
      assigneeUserId: 'user-9',
    });
  });

  it('resolves the submitter, the one strategy that cannot fail', () => {
    expect(resolveAssignment({ strategy: 'submitter' }, context())).toMatchObject({
      resolved: true,
      assigneeUserId: SUBMITTER,
    });

    // Even with an otherwise empty directory and no line manager.
    const bare = context({
      submitter: { userId: SUBMITTER, department: null, roles: [], lineManagerUserId: null },
      directory: { groupIdsByKey: {} },
    });
    expect(resolveAssignment({ strategy: 'submitter' }, bare).resolved).toBe(true);
  });

  it('resolves the line manager, and reports when there is not one', () => {
    expect(resolveAssignment({ strategy: 'lineManager' }, context())).toMatchObject({
      resolved: true,
      assigneeUserId: LINE_MANAGER,
    });

    const orphan = context({
      submitter: { userId: SUBMITTER, department: null, roles: [], lineManagerUserId: null },
    });
    const result = resolveAssignment({ strategy: 'lineManager' }, orphan);
    expect(result.resolved).toBe(false);
    expect(result.reason).toContain('line manager');
  });

  it('leaves a role assignment as a claimable pool rather than picking someone', () => {
    // PRD.md §7: role tasks are claimable by any holder and the first to
    // claim owns it, so assigneeUserId stays null until then.
    expect(resolveAssignment({ strategy: 'role', role: 'approver' }, context())).toEqual({
      assigneeUserId: null,
      assigneeGroupId: null,
      assigneeRole: 'approver',
      resolved: true,
    });
  });

  it('maps a group key to a group id, and reports an unknown key', () => {
    expect(resolveAssignment({ strategy: 'group', groupKey: 'itSupport' }, context())).toEqual({
      assigneeUserId: null,
      assigneeGroupId: IT_GROUP_ID,
      assigneeRole: null,
      resolved: true,
    });

    const missing = resolveAssignment({ strategy: 'group', groupKey: 'nope' }, context());
    expect(missing.resolved).toBe(false);
    expect(missing.reason).toContain('nope');
  });

  it('resolves a field reference from submitted values', () => {
    const strategy: AssignmentStrategy = { strategy: 'fieldReference', fieldKey: 'approverId' };

    expect(
      resolveAssignmentWithValues(strategy, context(), { approverId: 'user-7' }),
    ).toMatchObject({ resolved: true, assigneeUserId: 'user-7' });

    expect(resolveAssignmentWithValues(strategy, context(), {}).resolved).toBe(false);
    expect(resolveAssignmentWithValues(strategy, context(), { approverId: '' }).resolved).toBe(
      false,
    );
    expect(resolveAssignmentWithValues(strategy, context(), { approverId: 42 }).resolved).toBe(
      false,
    );
  });

  it('delegates non-fieldReference strategies through the values-aware entry point', () => {
    expect(resolveAssignmentWithValues({ strategy: 'submitter' }, context(), {})).toMatchObject({
      resolved: true,
      assigneeUserId: SUBMITTER,
    });
  });

  it('reports lineManagerOfAssignee as not yet implemented rather than guessing', () => {
    const result = resolveAssignment({ strategy: 'lineManagerOfAssignee' }, context());
    expect(result.resolved).toBe(false);
    expect(result.reason).toContain('escalation');
  });

  it('reports an unrecognised strategy instead of throwing', () => {
    const result = resolveAssignment(
      { strategy: 'telepathy' } as unknown as AssignmentStrategy,
      context(),
    );
    expect(result.resolved).toBe(false);
    expect(result.reason).toContain('Unknown assignment strategy');
  });
});

describe('SLA due dates', () => {
  it('adds the step duration to the injected clock', () => {
    expect(computeDueAt({ durationHours: 48 }, '2026-08-14T12:00:00.000Z')).toBe(
      '2026-08-16T12:00:00.000Z',
    );
  });

  it('returns null when the step has no SLA', () => {
    expect(computeDueAt(undefined, '2026-08-14T12:00:00.000Z')).toBeNull();
  });

  it('returns null rather than an invalid date when the clock is unparseable', () => {
    expect(computeDueAt({ durationHours: 48 }, 'not-a-date')).toBeNull();
  });

  it('returns null when durationHours is missing from an otherwise present SLA', () => {
    expect(
      computeDueAt(
        { businessHoursOnly: true } as unknown as { durationHours: number },
        '2026-08-14T12:00:00.000Z',
      ),
    ).toBeNull();
  });
});
