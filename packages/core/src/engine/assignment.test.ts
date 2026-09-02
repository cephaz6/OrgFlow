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
    directory: { groupIdsByKey: { itSupport: IT_GROUP_ID }, activeDelegateByUserId: {} },
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
      directory: { groupIdsByKey: {}, activeDelegateByUserId: {} },
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

  it('resolves lineManagerOfAssignee from context.currentAssignee, not the submitter', () => {
    const withoutCurrentAssignee = resolveAssignment(
      { strategy: 'lineManagerOfAssignee' },
      context(),
    );
    expect(withoutCurrentAssignee.resolved).toBe(false);
    expect(withoutCurrentAssignee.reason).toContain('line manager');

    const ASSIGNEE_MANAGER = '00000000-0000-0000-0000-000000000009';
    const result = resolveAssignment(
      { strategy: 'lineManagerOfAssignee' },
      context({ currentAssignee: { lineManagerUserId: ASSIGNEE_MANAGER } }),
    );
    expect(result).toMatchObject({ resolved: true, assigneeUserId: ASSIGNEE_MANAGER });
  });

  it('redirects to an active delegate, recording who was delegated from', () => {
    const DELEGATE = '00000000-0000-0000-0000-0000000000de';
    const delegated = context({
      directory: {
        groupIdsByKey: {},
        activeDelegateByUserId: { [LINE_MANAGER]: DELEGATE },
      },
    });

    const result = resolveAssignment({ strategy: 'lineManager' }, delegated);
    expect(result).toMatchObject({
      resolved: true,
      assigneeUserId: DELEGATE,
      delegatedFromUserId: LINE_MANAGER,
    });
  });

  it('never redirects a role or group pool, which has no single resolved user to delegate', () => {
    const delegated = context({
      directory: {
        groupIdsByKey: { itSupport: IT_GROUP_ID },
        // Keyed by a user id that is never produced by a role/group
        // resolution, so this proves the point structurally: pool
        // strategies never look here at all.
        activeDelegateByUserId: { [IT_GROUP_ID]: '00000000-0000-0000-0000-0000000000de' },
      },
    });
    expect(resolveAssignment({ strategy: 'role', role: 'approver' }, delegated)).toEqual({
      assigneeUserId: null,
      assigneeGroupId: null,
      assigneeRole: 'approver',
      resolved: true,
    });
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
  it('spends the duration as working hours, not calendar hours', () => {
    // ADR-0044: durationHours are hours of the working day, so 48 of them
    // is six working days rather than two calendar ones. From Friday 12:00
    // the default calendar (UTC, weekdays, 09:00-17:00) has five hours left
    // that day, then eight on each of the next five weekdays, which is 45.
    // The last three are worked 09:00 to 12:00 on Monday the 24th.
    expect(computeDueAt({ durationHours: 48 }, '2026-08-14T12:00:00.000Z')).toBe(
      '2026-08-24T12:00:00.000Z',
    );
  });

  it('does not skip the weekend when businessHoursOnly is explicitly false', () => {
    expect(
      computeDueAt({ durationHours: 48, businessHoursOnly: false }, '2026-08-14T12:00:00.000Z'),
    ).toBe('2026-08-16T12:00:00.000Z');
  });

  it('spans several days even when no weekend is involved', () => {
    // Monday 12:00, 24 working hours: five hours on Monday, eight on
    // Tuesday and eight on Wednesday is 21, so the last three run 09:00 to
    // 12:00 on Thursday.
    expect(computeDueAt({ durationHours: 24 }, '2026-08-17T12:00:00.000Z')).toBe(
      '2026-08-20T12:00:00.000Z',
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
