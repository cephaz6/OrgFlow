import type { FormField } from '@orgflow/types';

// packages/core's compareOrdered requires both operands to be numbers or
// both to be strings, and refuses anything else rather than guessing. A
// number field's answer is stored as a real number (features/cases/
// field-input.tsx coerces it on change), so a threshold left as the raw
// string an <input> yields can never match: the branch is silently skipped
// and the case takes the default route instead. Typing the threshold to the
// field it will be compared against is what keeps the two sides comparable.
//
// A value that does not parse is deliberately left as the string it is,
// rather than becoming NaN. The engine then reports "cannot compare", which
// is a visible explanation, whereas NaN compares false against everything
// and explains nothing.
export function coerceValue(raw: string, field: FormField | undefined): string | number {
  const numeric = field?.type === 'number' || field?.type === 'currency';
  if (!numeric || raw === '' || Number.isNaN(Number(raw))) {
    return raw;
  }
  return Number(raw);
}
