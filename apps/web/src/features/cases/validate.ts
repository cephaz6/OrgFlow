import type { FormField } from '@orgflow/types';

// Client-side validation, which exists to tell the requester what is wrong
// before they submit. It is not a security boundary: the API validates
// independently, and this never sees a value the API will not check again.

// Field types that render no control and hold no value.
const STATIC_TYPES = new Set(['heading', 'paragraph']);

// Types the runtime cannot yet collect. `user` needs a directory endpoint
// that does not exist; `file` was here too until the attachment pipeline
// (PRD.md Phase 7) shipped. Listed rather than quietly skipped, because a
// required field nobody can answer has to block submission with an
// explanation instead of producing a case with a silent hole in it.
export const UNSUPPORTED_TYPES = new Set(['user']);

export function isStaticField(field: FormField): boolean {
  return STATIC_TYPES.has(field.type);
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
}

// 'today' and '+365d' are the forms the seeded definition uses. Anything
// else is treated as an ISO date, and an unparseable bound is ignored
// rather than failing the field: a malformed definition should not make a
// form impossible to submit, and the API validates independently.
function resolveDateBound(bound: string, today: Date): Date | null {
  if (bound === 'today') {
    return today;
  }

  const relative = /^([+-])(\d+)d$/.exec(bound);
  if (relative) {
    const days = Number(relative[2]) * (relative[1] === '-' ? -1 : 1);
    const shifted = new Date(today);
    shifted.setDate(shifted.getDate() + days);
    return shifted;
  }

  const parsed = new Date(bound);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function validateField(
  field: FormField,
  value: unknown,
  today: Date,
  attachmentCount: number,
): string | null {
  if (isStaticField(field)) {
    return null;
  }

  if (UNSUPPORTED_TYPES.has(field.type)) {
    return field.required
      ? 'This question cannot be answered yet, so the request cannot be submitted.'
      : null;
  }

  // A file field's "value" is never stored in the values document (the
  // confirmed attachment rows, keyed by fieldKey, are the source of truth
  // for what is attached), so its completeness is a count, not values[key].
  if (field.type === 'file') {
    return field.required && attachmentCount === 0 ? 'Attach at least one file.' : null;
  }

  if (isEmpty(value)) {
    // Only required-ness applies to an empty value: running a length or
    // range rule against nothing produces a second, confusing message about
    // a field the user simply has not filled in.
    return field.required ? 'Enter an answer.' : null;
  }

  switch (field.type) {
    case 'text':
    case 'textarea': {
      const text = String(value);
      const validation = field.validation;
      if (validation?.minLength !== undefined && text.length < validation.minLength) {
        return `Use at least ${validation.minLength} characters.`;
      }
      if (validation?.maxLength !== undefined && text.length > validation.maxLength) {
        return `Use ${validation.maxLength} characters or fewer.`;
      }
      if (
        field.type === 'text' &&
        field.validation?.pattern !== undefined &&
        !new RegExp(field.validation.pattern).test(text)
      ) {
        return 'Enter an answer in the format required.';
      }
      return null;
    }

    case 'number':
    case 'currency': {
      const numeric = Number(value);
      if (Number.isNaN(numeric)) {
        return 'Enter a number.';
      }
      const validation = field.validation;
      if (validation?.min !== undefined && numeric < validation.min) {
        return `Enter ${validation.min} or more.`;
      }
      if (validation?.max !== undefined && numeric > validation.max) {
        return `Enter ${validation.max} or less.`;
      }
      return null;
    }

    case 'email':
      // Deliberately loose. Anything stricter rejects addresses that are
      // valid, and the only real test of an address is sending to it.
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))
        ? null
        : 'Enter a valid email address.';

    case 'select':
    case 'radio':
      return field.options.some((option) => option.value === value)
        ? null
        : 'Choose one of the options.';

    case 'multiSelect': {
      const selected = Array.isArray(value) ? value : [];
      const validation = field.validation;
      if (validation?.minSelections !== undefined && selected.length < validation.minSelections) {
        return `Choose at least ${validation.minSelections} options.`;
      }
      if (validation?.maxSelections !== undefined && selected.length > validation.maxSelections) {
        return `Choose no more than ${validation.maxSelections} options.`;
      }
      return null;
    }

    case 'date':
    case 'dateTime': {
      const entered = new Date(String(value));
      if (Number.isNaN(entered.getTime())) {
        return 'Enter a valid date.';
      }
      const validation = field.validation;
      if (validation?.minDate !== undefined) {
        const min = resolveDateBound(validation.minDate, today);
        if (min && entered < min) {
          return `Enter a date on or after ${formatDate(min)}.`;
        }
      }
      if (validation?.maxDate !== undefined) {
        const max = resolveDateBound(validation.maxDate, today);
        if (max && entered > max) {
          return `Enter a date on or before ${formatDate(max)}.`;
        }
      }
      return null;
    }

    default:
      return null;
  }
}

// Only the fields passed in are checked, which is how a hidden field avoids
// blocking submission: the caller passes the visible ones.
export function validateFields(
  fields: FormField[],
  values: Record<string, unknown>,
  today: Date,
  attachmentCountByFieldKey: Record<string, number> = {},
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const message = validateField(
      field,
      values[field.key],
      today,
      attachmentCountByFieldKey[field.key] ?? 0,
    );
    if (message) {
      errors[field.key] = message;
    }
  }

  return errors;
}
