import { describe, expect, it } from 'vitest';

import { describeVisibilityChange, type VisibleShape } from './announce-visibility';

function shape(
  sections: { key: string; title: string }[],
  fields: { key: string; label: string; sectionKey: string }[],
): VisibleShape {
  return { sections, fields };
}

const DETAILS = { key: 'details', title: 'Request details' };
const APPROVAL = { key: 'approval', title: 'Approval details' };

const REASON = { key: 'reason', label: 'Reason for the request', sectionKey: 'details' };
const COST = { key: 'cost', label: 'Estimated cost', sectionKey: 'details' };
const APPROVER = { key: 'approver', label: 'Approver', sectionKey: 'approval' };

describe('describeVisibilityChange', () => {
  it('stays silent when nothing has appeared or disappeared', () => {
    const before = shape([DETAILS], [REASON]);
    expect(describeVisibilityChange(before, before)).toBeNull();
  });

  it('stays silent when only an answer changed, not what is visible', () => {
    expect(
      describeVisibilityChange(shape([DETAILS], [REASON, COST]), shape([DETAILS], [REASON, COST])),
    ).toBeNull();
  });

  it('names a single revealed question rather than counting it', () => {
    expect(
      describeVisibilityChange(shape([DETAILS], [REASON]), shape([DETAILS], [REASON, COST])),
    ).toBe('Estimated cost added.');
  });

  it('names a single hidden question', () => {
    expect(
      describeVisibilityChange(shape([DETAILS], [REASON, COST]), shape([DETAILS], [REASON])),
    ).toBe('Estimated cost removed.');
  });

  it('leads with the count when several questions arrive at once', () => {
    const after = shape(
      [DETAILS],
      [REASON, COST, { key: 'model', label: 'Model', sectionKey: 'details' }],
    );
    expect(describeVisibilityChange(shape([DETAILS], [REASON]), after)).toBe(
      '2 questions added: Estimated cost, Model.',
    );
  });

  it('truncates a long list, because a spoken list stops being holdable', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((key) => ({
      key,
      label: key.toUpperCase(),
      sectionKey: 'details',
    }));
    expect(describeVisibilityChange(shape([DETAILS], []), shape([DETAILS], many))).toBe(
      '5 questions added: A, B, C and 2 more.',
    );
  });

  it('announces a whole section by name, with how much it contains', () => {
    expect(
      describeVisibilityChange(
        shape([DETAILS], [REASON]),
        shape([DETAILS, APPROVAL], [REASON, APPROVER]),
      ),
    ).toBe('Approval details section added, with 1 question.');
  });

  it('does not also list the questions inside a section it has just named', () => {
    const after = shape(
      [DETAILS, APPROVAL],
      [REASON, APPROVER, { key: 'limit', label: 'Spend limit', sectionKey: 'approval' }],
    );
    const message = describeVisibilityChange(shape([DETAILS], [REASON]), after);
    expect(message).toBe('Approval details section added, with 2 questions.');
    expect(message).not.toContain('Approver');
  });

  it('describes a section with no questions of its own without saying zero', () => {
    expect(
      describeVisibilityChange(shape([DETAILS], [REASON]), shape([DETAILS, APPROVAL], [REASON])),
    ).toBe('Approval details section added.');
  });

  it('reports an addition and a removal together, additions first', () => {
    expect(describeVisibilityChange(shape([DETAILS], [REASON]), shape([DETAILS], [COST]))).toBe(
      'Estimated cost added. Reason for the request removed.',
    );
  });

  it('announces a section disappearing, counting what it used to hold', () => {
    expect(
      describeVisibilityChange(
        shape([DETAILS, APPROVAL], [REASON, APPROVER]),
        shape([DETAILS], [REASON]),
      ),
    ).toBe('Approval details section removed, with 1 question.');
  });

  it('counts sections rather than describing each when several change', () => {
    const extra = { key: 'costs', title: 'Costs' };
    expect(
      describeVisibilityChange(
        shape([DETAILS], [REASON]),
        shape([DETAILS, APPROVAL, extra], [REASON]),
      ),
    ).toBe('2 sections added: Approval details, Costs.');
  });
});
