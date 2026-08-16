import type { FormSection, ProcessDefinitionDocument } from '@orgflow/types';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
  // A field or section key, so the validation panel can link straight to
  // what it is complaining about rather than leaving the builder to search.
  sectionKey?: string;
  fieldKey?: string;
}

const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const OPTION_TYPES = new Set(['select', 'multiSelect', 'radio']);

// Structural checks only: this is what stands between a draft and a
// document the engine can actually run, not a judgement about whether the
// process itself makes sense. Errors block publish; warnings do not, since
// PRD.md §13.2 calls only some of the panel's findings publish-blocking.
export function validateDraft(
  document: Pick<ProcessDefinitionDocument, 'form'>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const sections = document.form.sections;

  if (sections.length === 0) {
    issues.push({ severity: 'warning', message: 'This form has no sections yet.' });
  }

  const seenSectionKeys = new Set<string>();
  const seenFieldKeys = new Set<string>();
  const allFieldKeys: string[] = [];

  for (const section of sections) {
    checkSectionKey(section, seenSectionKeys, issues);

    if (section.fields.length === 0) {
      issues.push({
        severity: 'warning',
        message: `"${section.title}" has no fields.`,
        sectionKey: section.key,
      });
    }

    for (const field of section.fields) {
      allFieldKeys.push(field.key);
      checkFieldKey(field.key, section.key, seenFieldKeys, issues);

      if (!field.label.trim()) {
        issues.push({
          severity: 'error',
          message: 'A field is missing a label.',
          sectionKey: section.key,
          fieldKey: field.key,
        });
      }

      if (OPTION_TYPES.has(field.type) && 'options' in field) {
        if (field.options.length === 0) {
          issues.push({
            severity: 'error',
            message: `"${field.label || field.key}" has no options.`,
            sectionKey: section.key,
            fieldKey: field.key,
          });
        }
        for (const option of field.options) {
          if (!option.label.trim() || !option.value.trim()) {
            issues.push({
              severity: 'error',
              message: `"${field.label || field.key}" has an option with no label or value.`,
              sectionKey: section.key,
              fieldKey: field.key,
            });
            break;
          }
        }
      }
    }
  }

  if (document.form.titleFieldKey && !allFieldKeys.includes(document.form.titleFieldKey)) {
    issues.push({
      severity: 'warning',
      message: 'The field chosen to title a request no longer exists on the form.',
    });
  }

  return issues;
}

function checkSectionKey(section: FormSection, seen: Set<string>, issues: ValidationIssue[]): void {
  if (!KEY_PATTERN.test(section.key)) {
    issues.push({
      severity: 'error',
      message: `Section "${section.title}" has an invalid key.`,
      sectionKey: section.key,
    });
  }
  if (seen.has(section.key)) {
    issues.push({
      severity: 'error',
      message: `Two sections share the key "${section.key}".`,
      sectionKey: section.key,
    });
  }
  seen.add(section.key);
}

function checkFieldKey(
  fieldKey: string,
  sectionKey: string,
  seen: Set<string>,
  issues: ValidationIssue[],
): void {
  if (!KEY_PATTERN.test(fieldKey)) {
    issues.push({
      severity: 'error',
      message: `Field "${fieldKey}" has an invalid key.`,
      sectionKey,
      fieldKey,
    });
  }
  if (seen.has(fieldKey)) {
    issues.push({
      severity: 'error',
      message: `Two fields share the key "${fieldKey}".`,
      sectionKey,
      fieldKey,
    });
  }
  seen.add(fieldKey);
}

export function hasBlockingIssues(issues: ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}
