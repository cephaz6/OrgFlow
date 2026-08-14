import type { Condition } from '@orgflow/types';

import { resolveFieldValue, type ConditionScope } from './field-reference.js';
import { applyOperator } from './operators.js';

export interface ConditionEvaluation {
  matched: boolean;
  // Everything that could not be evaluated meaningfully on the way to the
  // result. Returned rather than logged because packages/core does no I/O;
  // the engine surfaces these and they end up in the transition record's
  // conditionResult, which PRD.md §2.3 describes as "which branch was taken
  // and why".
  warnings: string[];
}

function evaluateInto(condition: Condition, scope: ConditionScope, warnings: string[]): boolean {
  // PRD.md §5.1: null is the default branch and is always true.
  if (condition === null) {
    return true;
  }

  if ('all' in condition) {
    // Every branch is evaluated even once the answer is settled, so a
    // warning in a later branch is still reported. These are small
    // tenant-authored expressions, not hot-path code.
    const results = condition.all.map((child) => evaluateInto(child, scope, warnings));
    return results.every(Boolean);
  }

  if ('any' in condition) {
    const results = condition.any.map((child) => evaluateInto(child, scope, warnings));
    return results.some(Boolean);
  }

  if ('not' in condition) {
    return !evaluateInto(condition.not, scope, warnings);
  }

  const resolved = resolveFieldValue(condition.field, scope);
  if (!resolved.known) {
    // PRD.md §5.3: an unknown field key is false with a warning, never a
    // throw. Only a `$` reference reaches here; an absent form field
    // resolves to null and is compared normally.
    warnings.push(`Unknown field reference '${condition.field}'.`);
    return false;
  }

  const outcome = applyOperator(condition.operator, resolved.value, condition.value);
  if (outcome.warning) {
    warnings.push(`${outcome.warning} (field '${condition.field}')`);
  }

  return outcome.matched;
}

// The pure condition evaluator. PRD.md §5: never eval, never a templating
// engine; tenant-authored expressions are untrusted input interpreted by
// this function alone.
//
// It does not throw on tenant data. The single exception is an unknown
// operator, which is a malformed definition rather than bad data and is
// caught by publish-time validation; see applyOperator.
export function evaluateCondition(
  condition: Condition,
  scope: ConditionScope,
): ConditionEvaluation {
  const warnings: string[] = [];
  const matched = evaluateInto(condition, scope, warnings);
  return { matched, warnings };
}
