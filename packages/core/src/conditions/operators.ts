import type { ConditionOperator } from '@orgflow/types';

export interface OperatorOutcome {
  matched: boolean;
  // Set when the comparison could not be made meaningfully: comparing a
  // string to a number, or passing a non-array to `in`. PRD.md §5.3 says
  // these yield false and log a warning. packages/core performs no I/O, so
  // the warning is returned for the caller to record rather than logged.
  warning?: string;
}

const MATCHED: OperatorOutcome = { matched: true };
const UNMATCHED: OperatorOutcome = { matched: false };

export class UnknownConditionOperatorError extends Error {
  constructor(public readonly operator: string) {
    super(`Unknown condition operator: ${operator}`);
    this.name = 'UnknownConditionOperatorError';
  }
}

function isEmptyValue(value: unknown): boolean {
  // PRD.md §5.3: null, empty string and empty array are all empty.
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

// Deep-ish equality, sufficient for form values: primitives compare by
// value, arrays element-wise. Form fields never hold nested objects, so
// recursing further would be building for a case that cannot arise.
function looseEquals(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual) && Array.isArray(expected)) {
    return (
      actual.length === expected.length &&
      actual.every((element, index) => element === expected[index])
    );
  }
  return actual === expected;
}

// PRD.md §5.3: an ordered comparison against null is false, never an error,
// and a type mismatch is false with a warning. Numbers compare numerically
// and strings lexicographically; anything mixed is a mismatch.
function compareOrdered(
  operator: 'gt' | 'gte' | 'lt' | 'lte',
  actual: unknown,
  expected: unknown,
): OperatorOutcome {
  if (actual === null || expected === null || expected === undefined) {
    return UNMATCHED;
  }

  const bothNumbers = typeof actual === 'number' && typeof expected === 'number';
  const bothStrings = typeof actual === 'string' && typeof expected === 'string';

  if (!bothNumbers && !bothStrings) {
    return {
      matched: false,
      warning: `Cannot compare ${typeof actual} with ${typeof expected} using '${operator}'.`,
    };
  }

  switch (operator) {
    case 'gt':
      return actual > expected ? MATCHED : UNMATCHED;
    case 'gte':
      return actual >= expected ? MATCHED : UNMATCHED;
    case 'lt':
      return actual < expected ? MATCHED : UNMATCHED;
    case 'lte':
      return actual <= expected ? MATCHED : UNMATCHED;
  }
}

// Note on the negating operators (neq, notIn, notContains): when the
// underlying comparison is unevaluable they return false, not true.
// PRD.md §5.3's guiding principle is that an unevaluable condition is
// false; letting a negation succeed by default would route a case down a
// branch precisely because the data was unusable.
export function applyOperator(
  operator: ConditionOperator,
  actual: unknown,
  expected: unknown,
): OperatorOutcome {
  switch (operator) {
    case 'eq':
      // PRD.md §5.3: with eq and neq, null is compared normally, so
      // null eq null is true rather than unevaluable.
      return looseEquals(actual, expected) ? MATCHED : UNMATCHED;
    case 'neq':
      return looseEquals(actual, expected) ? UNMATCHED : MATCHED;

    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return compareOrdered(operator, actual, expected);

    case 'in':
    case 'notIn': {
      if (!Array.isArray(expected)) {
        return {
          matched: false,
          warning: `Operator '${operator}' requires an array value, received ${typeof expected}.`,
        };
      }
      const found = expected.some((candidate) => looseEquals(actual, candidate));
      return (operator === 'in' ? found : !found) ? MATCHED : UNMATCHED;
    }

    case 'contains':
    case 'notContains': {
      let found: boolean;
      if (typeof actual === 'string' && typeof expected === 'string') {
        found = actual.includes(expected);
      } else if (Array.isArray(actual)) {
        found = actual.some((candidate) => looseEquals(candidate, expected));
      } else {
        return {
          matched: false,
          warning: `Operator '${operator}' requires a string or array, received ${actual === null ? 'null' : typeof actual}.`,
        };
      }
      return (operator === 'contains' ? found : !found) ? MATCHED : UNMATCHED;
    }

    case 'startsWith':
    case 'endsWith': {
      if (typeof actual !== 'string' || typeof expected !== 'string') {
        return {
          matched: false,
          warning: `Operator '${operator}' requires strings, received ${actual === null ? 'null' : typeof actual} and ${typeof expected}.`,
        };
      }
      const found =
        operator === 'startsWith' ? actual.startsWith(expected) : actual.endsWith(expected);
      return found ? MATCHED : UNMATCHED;
    }

    case 'isEmpty':
      return isEmptyValue(actual) ? MATCHED : UNMATCHED;
    case 'isNotEmpty':
      return isEmptyValue(actual) ? UNMATCHED : MATCHED;

    case 'isTrue':
      return actual === true ? MATCHED : UNMATCHED;
    case 'isFalse':
      return actual === false ? MATCHED : UNMATCHED;

    default: {
      // PRD.md §5.3 is explicit that this one case throws, and it is the
      // only one that does. An unknown operator is a malformed definition,
      // caught by validation at publish time, not a data problem to be
      // tolerated at runtime; swallowing it would hide a broken definition
      // behind a silently false branch.
      const exhaustive: never = operator;
      throw new UnknownConditionOperatorError(String(exhaustive));
    }
  }
}
