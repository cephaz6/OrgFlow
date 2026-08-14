import type { Condition, ConditionOperator, EvaluationContext } from '@orgflow/types';
import { describe, expect, it } from 'vitest';

import { evaluateCondition } from './evaluate.js';
import type { ConditionScope } from './field-reference.js';
import { applyOperator, UnknownConditionOperatorError } from './operators.js';

const CONTEXT: EvaluationContext = {
  now: '2026-08-14T12:00:00.000Z',
  correlationId: 'test-correlation-id',
  submitter: {
    userId: '00000000-0000-0000-0000-000000000001',
    department: 'Engineering',
    roles: ['member', 'approver'],
    lineManagerUserId: '00000000-0000-0000-0000-000000000002',
  },
  case: { daysOpen: 3 },
  step: { escalationLevel: 1 },
  directory: { groupIdsByKey: {} },
};

function scope(values: Record<string, unknown>): ConditionScope {
  return { values, context: CONTEXT };
}

describe('operators', () => {
  // One row per operator per interesting case. PRD.md §5.1 lists sixteen
  // operators; every one appears here.
  const cases: Array<{
    operator: ConditionOperator;
    actual: unknown;
    expected: unknown;
    matched: boolean;
  }> = [
    { operator: 'eq', actual: 'mbp14', expected: 'mbp14', matched: true },
    { operator: 'eq', actual: 'mbp14', expected: 'mbp16', matched: false },
    { operator: 'eq', actual: 1200, expected: 1200, matched: true },
    { operator: 'neq', actual: 'mbp14', expected: 'mbp16', matched: true },
    { operator: 'neq', actual: 'mbp14', expected: 'mbp14', matched: false },

    { operator: 'gt', actual: 1200, expected: 1000, matched: true },
    { operator: 'gt', actual: 1000, expected: 1000, matched: false },
    { operator: 'gte', actual: 1000, expected: 1000, matched: true },
    { operator: 'lt', actual: 800, expected: 1000, matched: true },
    { operator: 'lt', actual: 1000, expected: 1000, matched: false },
    { operator: 'lte', actual: 1000, expected: 1000, matched: true },
    { operator: 'gt', actual: 'b', expected: 'a', matched: true },

    { operator: 'in', actual: 'mbp14', expected: ['mbp14', 'mbp16'], matched: true },
    { operator: 'in', actual: 'dellXps', expected: ['mbp14', 'mbp16'], matched: false },
    { operator: 'notIn', actual: 'dellXps', expected: ['mbp14', 'mbp16'], matched: true },
    { operator: 'notIn', actual: 'mbp14', expected: ['mbp14', 'mbp16'], matched: false },

    { operator: 'contains', actual: 'replacement laptop', expected: 'laptop', matched: true },
    { operator: 'contains', actual: ['a', 'b'], expected: 'b', matched: true },
    { operator: 'contains', actual: 'replacement', expected: 'laptop', matched: false },
    { operator: 'notContains', actual: 'replacement', expected: 'laptop', matched: true },

    { operator: 'startsWith', actual: 'LAP-000123', expected: 'LAP', matched: true },
    { operator: 'startsWith', actual: 'LAP-000123', expected: 'FIN', matched: false },
    { operator: 'endsWith', actual: 'LAP-000123', expected: '123', matched: true },
    { operator: 'endsWith', actual: 'LAP-000123', expected: '999', matched: false },

    { operator: 'isEmpty', actual: '', expected: undefined, matched: true },
    { operator: 'isEmpty', actual: [], expected: undefined, matched: true },
    { operator: 'isEmpty', actual: 'something', expected: undefined, matched: false },
    { operator: 'isNotEmpty', actual: 'something', expected: undefined, matched: true },
    { operator: 'isNotEmpty', actual: '', expected: undefined, matched: false },

    { operator: 'isTrue', actual: true, expected: undefined, matched: true },
    { operator: 'isTrue', actual: false, expected: undefined, matched: false },
    { operator: 'isTrue', actual: 'true', expected: undefined, matched: false },
    { operator: 'isFalse', actual: false, expected: undefined, matched: true },
    { operator: 'isFalse', actual: true, expected: undefined, matched: false },
  ];

  it.each(cases)(
    '$operator with $actual against $expected is $matched',
    ({ operator, actual, expected, matched }) => {
      expect(applyOperator(operator, actual, expected).matched).toBe(matched);
    },
  );

  it('throws on an unknown operator, the one case PRD.md §5.3 says throws', () => {
    expect(() => applyOperator('doesNotExist' as ConditionOperator, 'a', 'b')).toThrow(
      UnknownConditionOperatorError,
    );
  });

  it('compares arrays element-wise under eq, for multi-select fields', () => {
    expect(applyOperator('eq', ['a', 'b'], ['a', 'b']).matched).toBe(true);
    expect(applyOperator('eq', ['a', 'b'], ['b', 'a']).matched).toBe(false);
    expect(applyOperator('eq', ['a'], ['a', 'b']).matched).toBe(false);
    expect(applyOperator('neq', ['a', 'b'], ['a', 'b']).matched).toBe(false);
  });

  it('warns rather than matching when startsWith or endsWith is given a non-string', () => {
    for (const operator of ['startsWith', 'endsWith'] as const) {
      const numeric = applyOperator(operator, 1200, 'LAP');
      expect(numeric.matched).toBe(false);
      expect(numeric.warning).toBeDefined();

      const nullish = applyOperator(operator, null, 'LAP');
      expect(nullish.matched).toBe(false);
      expect(nullish.warning).toContain('null');
    }
  });
});

// PRD.md §5.3 transcribed row by row. Its own words: "This is the most
// common source of workflow bugs. Behaviour is defined, not incidental."
describe('null and missing semantics (PRD.md §5.3)', () => {
  it('treats a field absent from values as null', () => {
    const result = evaluateCondition({ field: 'neverSubmitted', operator: 'isEmpty' }, scope({}));
    expect(result.matched).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('compares null normally under eq, so null eq null is true', () => {
    expect(
      evaluateCondition({ field: 'missing', operator: 'eq', value: null }, scope({})).matched,
    ).toBe(true);
    expect(
      evaluateCondition({ field: 'missing', operator: 'neq', value: null }, scope({})).matched,
    ).toBe(false);
    expect(
      evaluateCondition({ field: 'missing', operator: 'neq', value: 'x' }, scope({})).matched,
    ).toBe(true);
  });

  it('returns false, never an error, for an ordered comparison against null', () => {
    for (const operator of ['gt', 'gte', 'lt', 'lte'] as const) {
      const result = evaluateCondition(
        { field: 'estimatedCost', operator, value: 1000 },
        scope({}),
      );
      expect(result.matched).toBe(false);
    }
  });

  it('treats null as empty', () => {
    expect(
      evaluateCondition({ field: 'missing', operator: 'isEmpty' }, scope({ missing: null }))
        .matched,
    ).toBe(true);
  });

  it('returns false with a warning on a type mismatch', () => {
    const result = evaluateCondition(
      { field: 'justification', operator: 'gt', value: 1000 },
      scope({ justification: 'a written reason' }),
    );

    expect(result.matched).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('justification');
  });

  it('returns false with a warning on an unknown field reference', () => {
    const result = evaluateCondition(
      { field: '$submitter.nonsense', operator: 'eq', value: 'x' },
      scope({}),
    );

    expect(result.matched).toBe(false);
    expect(result.warnings).toEqual(["Unknown field reference '$submitter.nonsense'."]);
  });

  it('never lets a negating operator succeed just because the data was unusable', () => {
    // An unevaluable comparison is false whichever way it is phrased.
    // Otherwise a case would route down the "not" branch precisely because
    // its data was broken, which is the opposite of the intent.
    const notContains = evaluateCondition(
      { field: 'estimatedCost', operator: 'notContains', value: 'x' },
      scope({ estimatedCost: 1200 }),
    );
    expect(notContains.matched).toBe(false);
    expect(notContains.warnings).toHaveLength(1);

    const notIn = evaluateCondition(
      { field: 'laptopModel', operator: 'notIn', value: 'not-an-array' },
      scope({ laptopModel: 'mbp14' }),
    );
    expect(notIn.matched).toBe(false);
    expect(notIn.warnings).toHaveLength(1);
  });
});

describe('context references (PRD.md §5.2)', () => {
  it.each([
    ['$submitter.department', 'eq', 'Engineering', true],
    ['$submitter.department', 'eq', 'Finance', false],
    ['$case.daysOpen', 'gt', 1, true],
    ['$case.daysOpen', 'gt', 10, false],
    ['$step.escalationLevel', 'gte', 1, true],
    ['$now', 'startsWith', '2026', true],
  ] as const)('resolves %s', (field, operator, value, matched) => {
    expect(evaluateCondition({ field, operator, value }, scope({})).matched).toBe(matched);
  });

  it('resolves an array-valued context reference', () => {
    expect(
      evaluateCondition(
        { field: '$submitter.roles', operator: 'contains', value: 'approver' },
        scope({}),
      ).matched,
    ).toBe(true);
  });
});

describe('composition', () => {
  it('treats null as the always-true default branch', () => {
    expect(evaluateCondition(null, scope({})).matched).toBe(true);
  });

  it('evaluates all, any and not', () => {
    const values = { estimatedCost: 1200, laptopModel: 'mbp14' };

    const all: Condition = {
      all: [
        { field: 'estimatedCost', operator: 'gt', value: 1000 },
        { field: 'laptopModel', operator: 'eq', value: 'mbp14' },
      ],
    };
    expect(evaluateCondition(all, scope(values)).matched).toBe(true);

    const allWithFalse: Condition = {
      all: [
        { field: 'estimatedCost', operator: 'gt', value: 1000 },
        { field: 'laptopModel', operator: 'eq', value: 'dellXps' },
      ],
    };
    expect(evaluateCondition(allWithFalse, scope(values)).matched).toBe(false);

    const any: Condition = {
      any: [
        { field: 'laptopModel', operator: 'eq', value: 'dellXps' },
        { field: 'estimatedCost', operator: 'gt', value: 1000 },
      ],
    };
    expect(evaluateCondition(any, scope(values)).matched).toBe(true);

    const not: Condition = { not: { field: 'estimatedCost', operator: 'gt', value: 1000 } };
    expect(evaluateCondition(not, scope(values)).matched).toBe(false);
  });

  it('nests to arbitrary depth', () => {
    const condition: Condition = {
      all: [
        { field: 'estimatedCost', operator: 'gt', value: 1000 },
        {
          any: [
            { field: '$submitter.department', operator: 'eq', value: 'Engineering' },
            { field: 'urgent', operator: 'isTrue' },
          ],
        },
      ],
    };

    expect(evaluateCondition(condition, scope({ estimatedCost: 1200 })).matched).toBe(true);
  });

  it('collects warnings from every branch, including ones that did not decide the result', () => {
    const condition: Condition = {
      all: [
        { field: 'estimatedCost', operator: 'gt', value: 1000 },
        { field: '$unknown.reference', operator: 'eq', value: 'x' },
      ],
    };

    const result = evaluateCondition(condition, scope({ estimatedCost: 1200 }));
    expect(result.matched).toBe(false);
    expect(result.warnings).toEqual(["Unknown field reference '$unknown.reference'."]);
  });

  it('is deterministic and does not mutate its inputs', () => {
    const values = { estimatedCost: 1200 };
    const condition: Condition = { field: 'estimatedCost', operator: 'gt', value: 1000 };

    const first = evaluateCondition(condition, scope(values));
    const second = evaluateCondition(condition, scope(values));

    expect(first).toEqual(second);
    expect(values).toEqual({ estimatedCost: 1200 });
    expect(condition).toEqual({ field: 'estimatedCost', operator: 'gt', value: 1000 });
  });
});

describe('the Laptop Request branch (PRD.md §4)', () => {
  // The actual condition the seeded definition branches on, so this is the
  // one that decides whether a real case needs finance approval.
  const financeBranch: Condition = { field: 'estimatedCost', operator: 'gt', value: 1000 };

  it('routes to finance approval above the threshold', () => {
    expect(evaluateCondition(financeBranch, scope({ estimatedCost: 1200 })).matched).toBe(true);
  });

  it('skips finance approval at or below the threshold', () => {
    expect(evaluateCondition(financeBranch, scope({ estimatedCost: 1000 })).matched).toBe(false);
    expect(evaluateCondition(financeBranch, scope({ estimatedCost: 800 })).matched).toBe(false);
  });

  it('skips finance approval rather than crashing when the cost is missing', () => {
    const result = evaluateCondition(financeBranch, scope({}));
    expect(result.matched).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('shows the otherModelDetail visibility rule working', () => {
    const visibleWhen: Condition = { field: 'laptopModel', operator: 'eq', value: 'other' };
    expect(evaluateCondition(visibleWhen, scope({ laptopModel: 'other' })).matched).toBe(true);
    expect(evaluateCondition(visibleWhen, scope({ laptopModel: 'mbp14' })).matched).toBe(false);
  });
});
