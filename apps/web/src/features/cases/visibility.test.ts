import type { FormField } from '@orgflow/types';
import { describe, expect, it } from 'vitest';

import { isVisible, visibleFields, type VisibilityInput } from './visibility';

function inputWith(values: Record<string, unknown>): VisibilityInput {
  return {
    values,
    roles: ['member'],
    userId: '00000000-0000-7000-8000-000000000001',
    now: '2026-08-16T09:00:00.000Z',
  };
}

describe('isVisible', () => {
  it('shows a field with no condition', () => {
    expect(isVisible(null, inputWith({}))).toBe(true);
    expect(isVisible(undefined, inputWith({}))).toBe(true);
  });

  it('evaluates a condition against another answer, both ways', () => {
    // The seeded Laptop Request's otherModelDetail field.
    const condition = { field: 'laptopModel', operator: 'eq' as const, value: 'other' };
    expect(isVisible(condition, inputWith({ laptopModel: 'other' }))).toBe(true);
    expect(isVisible(condition, inputWith({ laptopModel: 'mbp14' }))).toBe(false);
  });

  it('treats an unanswered field as null rather than as a match', () => {
    const condition = { field: 'laptopModel', operator: 'eq' as const, value: 'other' };
    expect(isVisible(condition, inputWith({}))).toBe(false);
  });

  it('evaluates a numeric threshold, which is what drives the branch', () => {
    const condition = { field: 'estimatedCost', operator: 'gt' as const, value: 1000 };
    expect(isVisible(condition, inputWith({ estimatedCost: 1500 }))).toBe(true);
    expect(isVisible(condition, inputWith({ estimatedCost: 1000 }))).toBe(false);
  });

  it('shows a field whose condition needs context the browser does not have', () => {
    // Fails open deliberately. Hiding it would let a request be submitted
    // without an answer the server considers required, and the requester
    // would never have been asked the question.
    const condition = { field: '$submitter.department', operator: 'eq' as const, value: 'Finance' };
    expect(isVisible(condition, inputWith({}))).toBe(true);
  });

  it('fails open even when the unavailable reference is nested in a group', () => {
    const condition = {
      all: [
        { field: 'estimatedCost', operator: 'gt' as const, value: 1000 },
        { field: '$submitter.department', operator: 'eq' as const, value: 'Finance' },
      ],
    };
    // The cost arm alone would be false at £10, so a naive evaluation
    // would hide this. The unavailable reference has to win.
    expect(isVisible(condition, inputWith({ estimatedCost: 10 }))).toBe(true);
  });

  it('still evaluates context references the browser can supply', () => {
    const condition = { field: '$submitter.roles', operator: 'contains' as const, value: 'member' };
    expect(isVisible(condition, inputWith({}))).toBe(true);
  });
});

describe('visibleFields', () => {
  it('filters a section down to the fields that apply', () => {
    const fields: FormField[] = [
      { key: 'laptopModel', type: 'text', label: 'Model' },
      {
        key: 'otherModelDetail',
        type: 'text',
        label: 'Describe it',
        visibleWhen: { field: 'laptopModel', operator: 'eq', value: 'other' },
      },
    ];

    const section = { key: 'details', title: 'Details', fields };

    expect(visibleFields(section, inputWith({ laptopModel: 'mbp14' })).map((f) => f.key)).toEqual([
      'laptopModel',
    ]);
    expect(visibleFields(section, inputWith({ laptopModel: 'other' })).map((f) => f.key)).toEqual([
      'laptopModel',
      'otherModelDetail',
    ]);
  });
});
