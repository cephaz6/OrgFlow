import type { FormField } from '@orgflow/types';
import { describe, expect, it } from 'vitest';

import { validateFields } from './validate';

const TODAY = new Date('2026-08-16T00:00:00.000Z');

function fieldsOf(...fields: FormField[]): FormField[] {
  return fields;
}

describe('validateFields', () => {
  it('reports a required field that has been left blank', () => {
    const fields = fieldsOf({ key: 'why', type: 'textarea', label: 'Why?', required: true });
    expect(validateFields(fields, {}, TODAY)).toEqual({ why: 'Enter an answer.' });
  });

  it('treats whitespace as blank', () => {
    // Otherwise a space satisfies a mandatory justification, which is
    // exactly the kind of answer an approver then has to chase.
    const fields = fieldsOf({ key: 'why', type: 'textarea', label: 'Why?', required: true });
    expect(validateFields(fields, { why: '   ' }, TODAY)).toEqual({ why: 'Enter an answer.' });
  });

  it('leaves an optional blank field alone', () => {
    const fields = fieldsOf({
      key: 'note',
      type: 'text',
      label: 'Note',
      validation: { minLength: 10 },
    });
    // The length rule must not fire on an answer nobody was required to
    // give; otherwise an optional field becomes impossible to skip.
    expect(validateFields(fields, { note: '' }, TODAY)).toEqual({});
  });

  it('applies length rules only once there is something to measure', () => {
    const fields = fieldsOf({
      key: 'why',
      type: 'textarea',
      label: 'Why?',
      required: true,
      validation: { minLength: 20, maxLength: 2000 },
    });
    expect(validateFields(fields, { why: 'too short' }, TODAY)).toEqual({
      why: 'Use at least 20 characters.',
    });
  });

  it('applies numeric bounds to a currency field', () => {
    const fields = fieldsOf({
      key: 'cost',
      type: 'currency',
      label: 'Estimated cost',
      required: true,
      validation: { min: 0, max: 10000 },
    });
    expect(validateFields(fields, { cost: 12000 }, TODAY)).toEqual({
      cost: 'Enter 10000 or less.',
    });
    expect(validateFields(fields, { cost: 999 }, TODAY)).toEqual({});
  });

  it('accepts zero rather than treating it as unanswered', () => {
    // The bug this guards against is using a falsy check for emptiness,
    // which makes a legitimate £0 estimate read as a missing answer.
    const fields = fieldsOf({
      key: 'cost',
      type: 'currency',
      label: 'Estimated cost',
      required: true,
      validation: { min: 0 },
    });
    expect(validateFields(fields, { cost: 0 }, TODAY)).toEqual({});
  });

  it('rejects a value that is not one of the offered options', () => {
    const fields = fieldsOf({
      key: 'model',
      type: 'select',
      label: 'Model',
      required: true,
      options: [{ value: 'mbp14', label: 'MacBook Pro 14-inch' }],
    });
    expect(validateFields(fields, { model: 'something-else' }, TODAY)).toEqual({
      model: 'Choose one of the options.',
    });
  });

  it('resolves the relative date bounds the seeded definition uses', () => {
    const fields = fieldsOf({
      key: 'requiredBy',
      type: 'date',
      label: 'When?',
      required: true,
      validation: { minDate: 'today', maxDate: '+365d' },
    });

    expect(validateFields(fields, { requiredBy: '2026-08-15' }, TODAY)).toEqual({
      requiredBy: 'Enter a date on or after 2026-08-16.',
    });
    expect(validateFields(fields, { requiredBy: '2027-09-01' }, TODAY)).toEqual({
      requiredBy: 'Enter a date on or before 2027-08-16.',
    });
    expect(validateFields(fields, { requiredBy: '2026-12-01' }, TODAY)).toEqual({});
  });

  it('ignores a date bound it cannot parse rather than making the form unsubmittable', () => {
    const fields = fieldsOf({
      key: 'when',
      type: 'date',
      label: 'When?',
      required: true,
      validation: { minDate: 'next tuesday' },
    });
    expect(validateFields(fields, { when: '2026-08-20' }, TODAY)).toEqual({});
  });

  it('blocks submission on a required question the runtime cannot collect', () => {
    const fields = fieldsOf({
      key: 'quote',
      type: 'file',
      label: 'Supplier quote',
      required: true,
    });
    expect(validateFields(fields, {}, TODAY)).toEqual({
      quote: 'This question cannot be answered yet, so the request cannot be submitted.',
    });
  });

  it('allows an optional question the runtime cannot collect', () => {
    // The seeded Laptop Request's quote field is exactly this: optional,
    // and visible only above £1,000. Blocking on it would make every
    // expensive request unsubmittable.
    const fields = fieldsOf({ key: 'quote', type: 'file', label: 'Supplier quote' });
    expect(validateFields(fields, {}, TODAY)).toEqual({});
  });

  it('ignores fields that render no control', () => {
    const fields = fieldsOf({ key: 'intro', type: 'paragraph', label: 'Some guidance' });
    expect(validateFields(fields, {}, TODAY)).toEqual({});
  });
});
