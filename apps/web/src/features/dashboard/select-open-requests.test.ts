import { describe, expect, it } from 'vitest';

import type { CaseResponse } from '../cases/types';
import { selectOpenRequests } from './select-open-requests';

function caseOf(overrides: Partial<CaseResponse>): CaseResponse {
  return {
    caseId: 'case-1',
    definitionId: 'def-1',
    versionId: 'ver-1',
    reference: 'LAP-000001',
    title: 'mbp14',
    status: 'active',
    outcome: null,
    currentStepKey: 'managerApproval',
    submittedByUserId: 'user-1',
    submittedAt: '2026-08-10T09:00:00.000Z',
    completedAt: null,
    dueAt: null,
    createdAt: '2026-08-10T09:00:00.000Z',
    updatedAt: '2026-08-10T09:00:00.000Z',
    ...overrides,
  };
}

describe('selectOpenRequests', () => {
  it('keeps only cases that are still open', () => {
    const cases = [
      caseOf({ caseId: 'active', status: 'active' }),
      caseOf({ caseId: 'unassigned', status: 'unassigned' }),
      caseOf({ caseId: 'completed', status: 'completed', outcome: 'approved' }),
      caseOf({ caseId: 'rejected', status: 'rejected', outcome: 'rejected' }),
      caseOf({ caseId: 'cancelled', status: 'cancelled', outcome: 'cancelled' }),
      caseOf({ caseId: 'draft', status: 'draft', submittedAt: null }),
    ];

    // `unassigned` counts as open deliberately: the case is not finished,
    // it is waiting for somebody to be found, and hiding it would make a
    // stuck request invisible to the person who raised it.
    expect(selectOpenRequests(cases).map((entry) => entry.caseId)).toEqual([
      'active',
      'unassigned',
    ]);
  });

  it('puts a returned case first, because it is the only one the requester can act on', () => {
    const cases = [
      caseOf({
        caseId: 'newer-but-not-mine-to-move',
        submittedAt: '2026-08-20T09:00:00.000Z',
      }),
      // Active with no current step and a submission date is what a
      // returned case looks like; nothing in `status` says so.
      caseOf({
        caseId: 'returned',
        currentStepKey: null,
        submittedAt: '2026-08-01T09:00:00.000Z',
      }),
    ];

    expect(selectOpenRequests(cases).map((entry) => entry.caseId)).toEqual([
      'returned',
      'newer-but-not-mine-to-move',
    ]);
  });

  it('orders the rest most recently submitted first', () => {
    const cases = [
      caseOf({ caseId: 'oldest', submittedAt: '2026-08-01T09:00:00.000Z' }),
      caseOf({ caseId: 'newest', submittedAt: '2026-08-20T09:00:00.000Z' }),
      caseOf({ caseId: 'middle', submittedAt: '2026-08-10T09:00:00.000Z' }),
    ];

    expect(selectOpenRequests(cases).map((entry) => entry.caseId)).toEqual([
      'newest',
      'middle',
      'oldest',
    ]);
  });

  it('does not mutate what it is given', () => {
    const cases = [
      caseOf({ caseId: 'oldest', submittedAt: '2026-08-01T09:00:00.000Z' }),
      caseOf({ caseId: 'newest', submittedAt: '2026-08-20T09:00:00.000Z' }),
    ];
    selectOpenRequests(cases);
    expect(cases[0]!.caseId).toBe('oldest');
  });
});
