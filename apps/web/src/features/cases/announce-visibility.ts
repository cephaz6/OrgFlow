import type { FormField, FormSection } from '@orgflow/types';

import { isStaticField } from './validate';

// Conditional visibility is silent by default. A requester answering
// "Is this for a new starter?" with "Yes" sees three more questions
// appear; a screen reader user is told nothing at all, and only discovers
// them by tabbing past the end of where the form used to stop. WCAG 2.2
// AA treats that as a change of context that must be announced, and
// CLAUDE.md §3 makes accessibility a completion criterion rather than a
// follow-up.
//
// This is the pure half: what to say, given what was visible before and
// what is visible now. The runtime owns when to say it.

export interface VisibleShape {
  sections: { key: string; title: string }[];
  // sectionKey lets a field that arrived only because its whole section
  // arrived be attributed to the section, rather than announced twice.
  fields: { key: string; label: string; sectionKey: string }[];
}

// Beyond this, reading every label aloud costs more than it conveys, so
// the count leads and the listing is truncated. Three is the point at
// which a spoken list stops being holdable in memory.
const MAX_LABELS_SPOKEN = 3;

/**
 * Describes the visible questions of a form, for comparison against a
 * later state. Static content (headings, guidance paragraphs) is excluded:
 * the announcement speaks of questions, and a revealed heading is read
 * when the user reaches it.
 */
export function describeVisible(
  sections: FormSection[],
  visibleIn: (section: FormSection) => FormField[],
): VisibleShape {
  return {
    sections: sections.map((section) => ({ key: section.key, title: section.title })),
    fields: sections.flatMap((section) =>
      visibleIn(section)
        .filter((field) => !isStaticField(field))
        .map((field) => ({ key: field.key, label: field.label, sectionKey: section.key })),
    ),
  };
}

function listLabels(labels: string[]): string {
  if (labels.length <= MAX_LABELS_SPOKEN) {
    return labels.join(', ');
  }
  const spoken = labels.slice(0, MAX_LABELS_SPOKEN).join(', ');
  return `${spoken} and ${labels.length - MAX_LABELS_SPOKEN} more`;
}

function questionPhrase(labels: string[], verb: 'added' | 'removed'): string {
  const [only] = labels;
  if (labels.length === 1 && only !== undefined) {
    return `${only} ${verb}`;
  }
  return `${labels.length} questions ${verb}: ${listLabels(labels)}`;
}

function sectionPhrase(
  sections: { title: string; questionCount: number }[],
  verb: 'added' | 'removed',
): string {
  const [only] = sections;
  if (sections.length === 1 && only !== undefined) {
    const count = only.questionCount === 1 ? '1 question' : `${only.questionCount} questions`;
    // A section with no questions of its own is still a change worth
    // hearing, but "with 0 questions" is not how anyone would say it.
    return only.questionCount === 0
      ? `${only.title} section ${verb}`
      : `${only.title} section ${verb}, with ${count}`;
  }
  return `${sections.length} sections ${verb}: ${listLabels(sections.map((s) => s.title))}`;
}

/**
 * What changed between two visible shapes, phrased for a live region.
 * Returns null when nothing appeared or disappeared, so the caller can
 * stay silent rather than announce a no-op on every keystroke.
 */
export function describeVisibilityChange(
  previous: VisibleShape,
  next: VisibleShape,
): string | null {
  const previousSectionKeys = new Set(previous.sections.map((section) => section.key));
  const nextSectionKeys = new Set(next.sections.map((section) => section.key));
  const previousFieldKeys = new Set(previous.fields.map((field) => field.key));
  const nextFieldKeys = new Set(next.fields.map((field) => field.key));

  const addedSectionKeys = next.sections
    .filter((section) => !previousSectionKeys.has(section.key))
    .map((section) => section.key);
  const removedSectionKeys = previous.sections
    .filter((section) => !nextSectionKeys.has(section.key))
    .map((section) => section.key);

  const countIn = (shape: VisibleShape, sectionKey: string) =>
    shape.fields.filter((field) => field.sectionKey === sectionKey).length;

  const addedSections = next.sections
    .filter((section) => addedSectionKeys.includes(section.key))
    .map((section) => ({ title: section.title, questionCount: countIn(next, section.key) }));
  const removedSections = previous.sections
    .filter((section) => removedSectionKeys.includes(section.key))
    .map((section) => ({ title: section.title, questionCount: countIn(previous, section.key) }));

  // A field inside a section that has just appeared is already covered by
  // the section's own phrase, and saying both is the kind of repetition
  // that makes people switch the announcements off.
  const addedFields = next.fields
    .filter((field) => !previousFieldKeys.has(field.key))
    .filter((field) => !addedSectionKeys.includes(field.sectionKey))
    .map((field) => field.label);
  const removedFields = previous.fields
    .filter((field) => !nextFieldKeys.has(field.key))
    .filter((field) => !removedSectionKeys.includes(field.sectionKey))
    .map((field) => field.label);

  const parts: string[] = [];
  if (addedSections.length > 0) {
    parts.push(sectionPhrase(addedSections, 'added'));
  }
  if (addedFields.length > 0) {
    parts.push(questionPhrase(addedFields, 'added'));
  }
  if (removedSections.length > 0) {
    parts.push(sectionPhrase(removedSections, 'removed'));
  }
  if (removedFields.length > 0) {
    parts.push(questionPhrase(removedFields, 'removed'));
  }

  return parts.length === 0 ? null : `${parts.join('. ')}.`;
}
