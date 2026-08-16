import type { FormField, FormSection } from '@orgflow/types';

// Pure operations on a document's form.sections, shared by the pointer
// drag-and-drop path and the keyboard "move up / move down / move to
// section" controls (CLAUDE.md §3: every drag interaction needs a keyboard
// equivalent, and sharing the implementation is what keeps the two from
// drifting apart). Nothing here touches React state directly; the builder
// component calls these and replaces its document with the result.

export function moveSection(
  sections: FormSection[],
  sectionKey: string,
  direction: -1 | 1,
): FormSection[] {
  const index = sections.findIndex((section) => section.key === sectionKey);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= sections.length) {
    return sections;
  }
  const next = [...sections];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function moveFieldWithinSection(
  sections: FormSection[],
  sectionKey: string,
  fieldKey: string,
  direction: -1 | 1,
): FormSection[] {
  return sections.map((section) => {
    if (section.key !== sectionKey) {
      return section;
    }
    const index = section.fields.findIndex((field) => field.key === fieldKey);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= section.fields.length) {
      return section;
    }
    const fields = [...section.fields];
    [fields[index], fields[target]] = [fields[target]!, fields[index]!];
    return { ...section, fields };
  });
}

// Moves a field to the end of a different section. Used by both the
// keyboard "move to section" control and a cross-section pointer drop.
export function moveFieldToSection(
  sections: FormSection[],
  fromSectionKey: string,
  fieldKey: string,
  toSectionKey: string,
): FormSection[] {
  if (fromSectionKey === toSectionKey) {
    return sections;
  }
  const from = sections.find((section) => section.key === fromSectionKey);
  const field = from?.fields.find((entry) => entry.key === fieldKey);
  if (!field) {
    return sections;
  }
  return sections.map((section) => {
    if (section.key === fromSectionKey) {
      return { ...section, fields: section.fields.filter((entry) => entry.key !== fieldKey) };
    }
    if (section.key === toSectionKey) {
      return { ...section, fields: [...section.fields, field] };
    }
    return section;
  });
}

// Reorders a field within a section to a specific index, the shape a
// pointer drop within the same list produces (as opposed to the
// one-step-at-a-time keyboard controls above).
export function reorderFieldWithinSection(
  sections: FormSection[],
  sectionKey: string,
  fromIndex: number,
  toIndex: number,
): FormSection[] {
  return sections.map((section) => {
    if (section.key !== sectionKey || fromIndex === toIndex) {
      return section;
    }
    const fields = [...section.fields];
    const [moved] = fields.splice(fromIndex, 1);
    if (!moved) {
      return section;
    }
    fields.splice(toIndex, 0, moved);
    return { ...section, fields };
  });
}

export function addField(
  sections: FormSection[],
  sectionKey: string,
  field: FormField,
): FormSection[] {
  return sections.map((section) =>
    section.key === sectionKey ? { ...section, fields: [...section.fields, field] } : section,
  );
}

export function removeField(
  sections: FormSection[],
  sectionKey: string,
  fieldKey: string,
): FormSection[] {
  return sections.map((section) =>
    section.key === sectionKey
      ? { ...section, fields: section.fields.filter((field) => field.key !== fieldKey) }
      : section,
  );
}

export function updateField(
  sections: FormSection[],
  sectionKey: string,
  fieldKey: string,
  next: FormField,
): FormSection[] {
  return sections.map((section) =>
    section.key === sectionKey
      ? {
          ...section,
          fields: section.fields.map((field) => (field.key === fieldKey ? next : field)),
        }
      : section,
  );
}

export function addSection(sections: FormSection[], section: FormSection): FormSection[] {
  return [...sections, section];
}

export function removeSection(sections: FormSection[], sectionKey: string): FormSection[] {
  return sections.filter((section) => section.key !== sectionKey);
}

export function updateSection(sections: FormSection[], next: FormSection): FormSection[] {
  return sections.map((section) => (section.key === next.key ? next : section));
}

// A stable key from a label: lower-cased, non-alphanumerics collapsed to
// single underscores, trimmed. Mirrors the server's key pattern
// (^[a-zA-Z][a-zA-Z0-9_]*$ in apps/api/src/processes/document-schema.ts), so
// a key generated here always survives validation. Falls back to a fixed
// prefix plus a short random suffix when the label has no letters at all
// (e.g. "123"), which the regex would otherwise reject outright.
export function keyFrom(label: string, existing: readonly string[]): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '');
  const root = base || `field_${Math.random().toString(36).slice(2, 7)}`;
  if (!existing.includes(root)) {
    return root;
  }
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${root}_${suffix}`;
    if (!existing.includes(candidate)) {
      return candidate;
    }
  }
  return `${root}_${Date.now()}`;
}
