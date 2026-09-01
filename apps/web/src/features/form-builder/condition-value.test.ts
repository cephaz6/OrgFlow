import { applyOperator } from '@orgflow/core';
import type { FormField } from '@orgflow/types';
import { describe, expect, it } from 'vitest';

import { coerceValue } from './condition-value';

function field(type: FormField['type']): FormField {
  return { key: 'cost', type, label: 'Cost' } as FormField;
}

describe('coerceValue', () => {
  it('stores a numeric threshold as a number, so the engine can compare it', () => {
    expect(coerceValue('1000', field('number'))).toBe(1000);
    expect(coerceValue('1000', field('currency'))).toBe(1000);
  });

  it('leaves a non-numeric field’s value as a string', () => {
    expect(coerceValue('approved', field('text'))).toBe('approved');
    expect(coerceValue('1000', field('text'))).toBe('1000');
  });

  it('leaves an empty value alone rather than turning it into zero', () => {
    expect(coerceValue('', field('number'))).toBe('');
  });

  it('leaves an unparseable value as a string rather than NaN', () => {
    // NaN compares false against everything and explains nothing; a string
    // reaches the engine's "cannot compare" warning, which is visible.
    expect(coerceValue('abc', field('number'))).toBe('abc');
  });

  it('leaves the value alone when the referenced field no longer exists', () => {
    expect(coerceValue('1000', undefined)).toBe('1000');
  });
});

// The regression this guards, stated against the engine itself rather than
// asserted second-hand: a threshold left as a string is not merely untidy,
// it makes the comparison unevaluable, so the branch is skipped in silence
// and the case takes the default route.
describe('the engine comparison this feeds', () => {
  it('cannot compare a number against a string threshold', () => {
    const outcome = applyOperator('gt', 2500, '1000');
    expect(outcome.matched).toBe(false);
    expect(outcome.warning).toContain('Cannot compare');
  });

  it('matches once the threshold is coerced', () => {
    const threshold = coerceValue('1000', field('number'));
    expect(applyOperator('gt', 2500, threshold).matched).toBe(true);
    expect(applyOperator('gt', 500, threshold).matched).toBe(false);
  });
});
