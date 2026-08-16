import type { FieldType, FormField } from '@orgflow/types';

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Short text',
  textarea: 'Long text',
  number: 'Number',
  currency: 'Currency',
  select: 'Dropdown',
  multiSelect: 'Multiple choice',
  radio: 'Single choice',
  checkbox: 'Checkbox',
  date: 'Date',
  dateTime: 'Date and time',
  file: 'File upload',
  user: 'Person',
  email: 'Email',
  phone: 'Phone',
  heading: 'Heading',
  paragraph: 'Paragraph text',
};

// The order the palette lists field types in: answerable types first
// (roughly most to least common), the two static layout types last, since
// they are not questions.
export const FIELD_TYPE_ORDER: FieldType[] = [
  'text',
  'textarea',
  'number',
  'currency',
  'select',
  'multiSelect',
  'radio',
  'checkbox',
  'date',
  'dateTime',
  'email',
  'phone',
  'user',
  'file',
  'heading',
  'paragraph',
];

const OPTION_TYPES = new Set<FieldType>(['select', 'multiSelect', 'radio']);

// A new field of the given type, ready to drop onto the canvas. key and
// label are filled in by the caller (see keyFrom in document-ops.ts), since
// they depend on what already exists in the section.
export function blankField(type: FieldType, key: string, label: string): FormField {
  const base = { key, type, label } as FormField;
  if (OPTION_TYPES.has(type)) {
    return { ...base, options: [{ value: 'option_1', label: 'Option 1' }] } as FormField;
  }
  return base;
}
