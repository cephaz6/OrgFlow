import { evaluateCondition } from '@orgflow/core';
import type { Condition, FormField, FormSection, OrganisationRole } from '@orgflow/types';

// ADR-0018: this is the engine's own evaluator, imported rather than
// reimplemented, so the browser cannot disagree with the server about
// whether a field was visible.
//
// The browser can supply every context reference PRD.md §5.2 defines except
// one. On a new draft $case.daysOpen is 0 and $step.escalationLevel is 0 by
// definition, $now is the clock and $submitter.roles comes from the session.
// $submitter.department is not on the session, so a condition that mentions
// it cannot be evaluated here.
const UNAVAILABLE_IN_BROWSER = '$submitter.department';

export interface VisibilityInput {
  values: Record<string, unknown>;
  roles: OrganisationRole[];
  userId: string;
  now: string;
}

// Walks the condition tree for a reference the browser cannot resolve.
// Returning true means "do not trust a local evaluation of this".
function referencesUnavailableContext(condition: Condition): boolean {
  if (condition === null) {
    return false;
  }
  if ('all' in condition) {
    return condition.all.some(referencesUnavailableContext);
  }
  if ('any' in condition) {
    return condition.any.some(referencesUnavailableContext);
  }
  if ('not' in condition) {
    return referencesUnavailableContext(condition.not);
  }
  return condition.field === UNAVAILABLE_IN_BROWSER;
}

export function isVisible(
  condition: Condition | null | undefined,
  input: VisibilityInput,
): boolean {
  if (condition === null || condition === undefined) {
    return true;
  }

  // Fails open, and the direction matters. Showing a field that turns out
  // to be hidden costs the requester an unnecessary question. Hiding one
  // that the server considers visible and required would produce a case
  // missing an answer nobody was ever asked for.
  if (referencesUnavailableContext(condition)) {
    return true;
  }

  return evaluateCondition(condition, {
    values: input.values,
    context: {
      now: input.now,
      // Nothing in a form condition can reference this, and no event is
      // emitted from the browser; it exists to satisfy the shared type.
      correlationId: '',
      submitter: {
        userId: input.userId,
        department: null,
        roles: input.roles,
        lineManagerUserId: null,
      },
      case: { daysOpen: 0 },
      step: { escalationLevel: 0 },
      directory: { groupIdsByKey: {} },
    },
  }).matched;
}

export function visibleFields(section: FormSection, input: VisibilityInput): FormField[] {
  return section.fields.filter((field) => isVisible(field.visibleWhen, input));
}

export function visibleSections(sections: FormSection[], input: VisibilityInput): FormSection[] {
  return sections.filter((section) => isVisible(section.visibleWhen, input));
}
