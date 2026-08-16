import type { FormField, ProcessDefinitionDocument } from '@orgflow/types';
import { describe, expect, it } from 'vitest';

import { hasBlockingIssues, validateDraft } from './validation';

function textField(key: string, label = key): FormField {
  return { key, type: 'text', label };
}

function documentWith(
  form: ProcessDefinitionDocument['form'],
): Pick<ProcessDefinitionDocument, 'form'> {
  return { form };
}

describe('validateDraft', () => {
  it('warns, but does not block, an empty form', () => {
    const issues = validateDraft(documentWith({ titleFieldKey: '', sections: [] }));
    expect(issues).toEqual([{ severity: 'warning', message: 'This form has no sections yet.' }]);
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it('warns about an empty section', () => {
    const issues = validateDraft(
      documentWith({
        titleFieldKey: '',
        sections: [{ key: 'details', title: 'Details', fields: [] }],
      }),
    );
    expect(issues).toContainEqual({
      severity: 'warning',
      message: '"Details" has no fields.',
      sectionKey: 'details',
    });
  });

  it('blocks on duplicate field keys across sections', () => {
    const issues = validateDraft(
      documentWith({
        titleFieldKey: '',
        sections: [
          { key: 'a', title: 'A', fields: [textField('amount')] },
          { key: 'b', title: 'B', fields: [textField('amount')] },
        ],
      }),
    );
    expect(hasBlockingIssues(issues)).toBe(true);
    expect(issues.some((issue) => issue.message.includes('share the key "amount"'))).toBe(true);
  });

  it('blocks a select field with no options', () => {
    const issues = validateDraft(
      documentWith({
        titleFieldKey: '',
        sections: [
          {
            key: 'a',
            title: 'A',
            fields: [{ key: 'choice', type: 'select', label: 'Choice', options: [] }],
          },
        ],
      }),
    );
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it('warns when the title field no longer exists', () => {
    const issues = validateDraft(
      documentWith({
        titleFieldKey: 'gone',
        sections: [{ key: 'a', title: 'A', fields: [textField('amount')] }],
      }),
    );
    expect(issues.some((issue) => issue.message.includes('title a request no longer exists'))).toBe(
      true,
    );
  });

  it('is silent on a well-formed form', () => {
    const issues = validateDraft(
      documentWith({
        titleFieldKey: 'amount',
        sections: [{ key: 'a', title: 'A', fields: [textField('amount', 'Amount')] }],
      }),
    );
    expect(issues).toEqual([]);
  });
});
