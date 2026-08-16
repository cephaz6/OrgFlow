import type { FormField, ProcessDefinitionDocument } from '@orgflow/types';

import { formatDate, formatDateTime } from './format';

export interface SubmittedValuesProps {
  document: ProcessDefinitionDocument;
  values: Record<string, unknown>;
}

// Renders the stored value the way the question asked for it, so a select
// shows the option's label rather than its stored code and a checkbox shows
// Yes or No rather than true.
function displayValue(field: FormField, value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return 'Not answered';
  }

  switch (field.type) {
    case 'select':
    case 'radio': {
      const option = field.options.find((entry) => entry.value === value);
      return option?.label ?? String(value);
    }

    case 'multiSelect': {
      const selected = Array.isArray(value) ? value : [value];
      const labels = selected.map(
        (entry) => field.options.find((option) => option.value === entry)?.label ?? String(entry),
      );
      return labels.join(', ');
    }

    case 'checkbox':
      return value === true ? 'Yes' : 'No';

    case 'date':
      // Formatted the same way every other date on the page is. A stored
      // ISO string is what the API holds, not what a requester should be
      // shown next to "Submitted 16 Aug 2026".
      return formatDate(String(value));

    case 'dateTime':
      return formatDateTime(String(value));

    case 'currency':
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(
        Number(value),
      );

    default:
      return String(value);
  }
}

const STATIC_TYPES = new Set(['heading', 'paragraph']);

// PRD.md §13.2, case detail: the submitted values. Driven by the *pinned*
// document, which is why the API returns it: iterating the document rather
// than the stored values object means the answers appear in the order they
// were asked, and a question left unanswered is shown as unanswered instead
// of silently missing from the list.
export function SubmittedValues({ document, values }: SubmittedValuesProps) {
  const answered = document.form.sections.flatMap((section) =>
    section.fields
      .filter((field) => !STATIC_TYPES.has(field.type))
      // A conditional question that did not apply was never asked, so
      // listing it as "Not answered" would misdescribe the case.
      .filter((field) => field.visibleWhen == null || field.key in values)
      .map((field) => ({ field, value: values[field.key] })),
  );

  return (
    <dl className="flex flex-col">
      {answered.map(({ field, value }) => (
        <div
          key={field.key}
          className="flex flex-col gap-1 border-b border-divider py-3 last:border-b-0 sm:flex-row sm:gap-4"
        >
          <dt className="text-sm text-muted-foreground sm:w-64 sm:shrink-0">{field.label}</dt>
          <dd className="text-sm">{displayValue(field, value)}</dd>
        </div>
      ))}
    </dl>
  );
}
