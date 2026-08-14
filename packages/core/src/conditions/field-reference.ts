import type { EvaluationContext } from '@orgflow/types';

export interface ConditionScope {
  values: Record<string, unknown>;
  context: EvaluationContext;
}

export interface ResolvedFieldValue {
  value: unknown;
  // False only for a `$`-prefixed reference that names nothing the
  // evaluator knows about. An ordinary form field that is simply absent
  // resolves to null and is known: PRD.md §5.3 treats a missing value as
  // null, which is a legitimate thing to compare against, whereas an
  // unrecognised `$` reference is a mistake in the definition.
  known: boolean;
}

// PRD.md §5.2: the documented context references, and only these. Anything
// else beginning with `$` is a definition error rather than a lookup miss,
// so it resolves as unknown and the caller records a warning.
function resolveContextReference(
  reference: string,
  context: EvaluationContext,
): ResolvedFieldValue {
  switch (reference) {
    case '$submitter.department':
      return { value: context.submitter.department, known: true };
    case '$submitter.roles':
      return { value: context.submitter.roles, known: true };
    case '$case.daysOpen':
      return { value: context.case.daysOpen, known: true };
    case '$step.escalationLevel':
      return { value: context.step.escalationLevel, known: true };
    case '$now':
      return { value: context.now, known: true };
    default:
      return { value: null, known: false };
  }
}

export function resolveFieldValue(reference: string, scope: ConditionScope): ResolvedFieldValue {
  if (reference.startsWith('$')) {
    return resolveContextReference(reference, scope.context);
  }

  // PRD.md §5.3: a field absent from values is treated as null, never an
  // error. undefined is normalised to null so every operator sees one
  // representation of "no value" rather than two.
  const value = scope.values[reference];
  return { value: value === undefined ? null : value, known: true };
}
