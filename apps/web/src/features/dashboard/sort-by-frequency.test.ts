import { describe, expect, it } from 'vitest';

import type { CatalogueEntry } from '../catalogue/api';
import type { CaseResponse } from '../cases/types';
import { sortCatalogueByFrequency } from './sort-by-frequency';

function entryOf(overrides: Partial<CatalogueEntry>): CatalogueEntry {
  return {
    definitionId: 'def-1',
    key: 'laptop-request',
    name: 'Laptop request',
    description: null,
    category: null,
    icon: null,
    status: 'published',
    currentVersionId: 'ver-1',
    createdAt: '2026-01-01T09:00:00.000Z',
    ...overrides,
  };
}

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

describe('sortCatalogueByFrequency', () => {
  it('puts the process started the most times first', () => {
    const entries = [
      entryOf({ definitionId: 'expense', key: 'expense-claim', name: 'Expense claim' }),
      entryOf({ definitionId: 'laptop', key: 'laptop-request', name: 'Laptop request' }),
    ];
    const cases = [
      caseOf({ definitionId: 'laptop' }),
      caseOf({ definitionId: 'laptop' }),
      caseOf({ definitionId: 'laptop' }),
      caseOf({ definitionId: 'expense' }),
    ];

    expect(sortCatalogueByFrequency(entries, cases).map((entry) => entry.definitionId)).toEqual([
      'laptop',
      'expense',
    ]);
  });

  it('leaves a never-started process in catalogue order, after every process that has been', () => {
    const entries = [
      entryOf({ definitionId: 'never-used', key: 'onboarding', name: 'Onboarding' }),
      entryOf({ definitionId: 'used-once', key: 'access-request', name: 'Access request' }),
      entryOf({ definitionId: 'also-never-used', key: 'expense-claim', name: 'Expense claim' }),
    ];
    const cases = [caseOf({ definitionId: 'used-once' })];

    expect(sortCatalogueByFrequency(entries, cases).map((entry) => entry.definitionId)).toEqual([
      'used-once',
      'never-used',
      'also-never-used',
    ]);
  });

  it('does not mutate the entries it is given', () => {
    const entries = [entryOf({ definitionId: 'a' }), entryOf({ definitionId: 'b' })];
    sortCatalogueByFrequency(entries, [caseOf({ definitionId: 'b' })]);
    expect(entries[0]!.definitionId).toBe('a');
  });
});
