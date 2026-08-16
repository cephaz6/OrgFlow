'use client';

import type { FieldOption, FormField } from '@orgflow/types';
import { Button, Input, Label, Textarea } from '@orgflow/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';

import { withOptional } from '../../lib/optional';
import { ConditionEditor } from './condition-editor';
import { FIELD_TYPE_LABELS } from './field-defaults';

export interface FieldPropertiesProps {
  field: FormField;
  // Every other field on the form, for the visibility condition's field
  // picker. Excludes this field itself: a field cannot depend on its own
  // answer.
  otherFields: FormField[];
  onChange: (field: FormField) => void;
  onDelete: () => void;
}

const OPTION_TYPES = new Set(['select', 'multiSelect', 'radio']);

function hasOptions(field: FormField): field is FormField & { options: FieldOption[] } {
  return OPTION_TYPES.has(field.type) && 'options' in field;
}

export function FieldProperties({ field, otherFields, onChange, onDelete }: FieldPropertiesProps) {
  const idPrefix = useId();
  // The acknowledgement PRD.md §13.2 asks for: ticking "contains personal
  // data" the first time surfaces an explanation, so it is a considered
  // choice rather than a checkbox ticked in passing. Shown once per field
  // per builder session, keyed on the checkbox already being unset.
  const [showPersonalDataNotice, setShowPersonalDataNotice] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {FIELD_TYPE_LABELS[field.type]}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onDelete}>
          <Trash2 aria-hidden="true" className="h-4 w-4" />
          Remove
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-label`}>Question label</Label>
        <Input
          id={`${idPrefix}-label`}
          value={field.label}
          onChange={(event) => onChange({ ...field, label: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">
          Key: <span className="font-mono">{field.key}</span>. Used by conditions and cannot be
          changed once the field exists.
        </p>
      </div>

      {field.type !== 'heading' && field.type !== 'paragraph' ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-hint`}>Hint (optional)</Label>
          <Textarea
            id={`${idPrefix}-hint`}
            value={field.hint ?? ''}
            onChange={(event) =>
              onChange(withOptional(field, 'hint', event.target.value || undefined))
            }
          />
        </div>
      ) : null}

      {hasOptions(field) ? (
        <div className="flex flex-col gap-2">
          <Label>Options</Label>
          {field.options.map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                aria-label={`Option ${index + 1} label`}
                value={option.label}
                onChange={(event) => {
                  const options = [...field.options];
                  options[index] = { ...option, label: event.target.value };
                  onChange({ ...field, options } as FormField);
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove option ${index + 1}`}
                disabled={field.options.length <= 1}
                onClick={() => {
                  const options = field.options.filter((_entry, i) => i !== index);
                  onChange({ ...field, options } as FormField);
                }}
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const next = field.options.length + 1;
              const options = [
                ...field.options,
                { value: `option_${next}`, label: `Option ${next}` },
              ];
              onChange({ ...field, options } as FormField);
            }}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add option
          </Button>
        </div>
      ) : null}

      {field.type !== 'heading' && field.type !== 'paragraph' ? (
        <div className="flex flex-col gap-3 border-t border-divider pt-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={field.required === true}
              onChange={(event) => onChange({ ...field, required: event.target.checked })}
            />
            Required
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={field.readOnlyAfterSubmit === true}
              onChange={(event) =>
                onChange({ ...field, readOnlyAfterSubmit: event.target.checked })
              }
            />
            Read-only once submitted
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={field.containsPersonalData === true}
              onChange={(event) => {
                const checked = event.target.checked;
                if (checked && field.containsPersonalData !== true) {
                  setShowPersonalDataNotice(true);
                }
                onChange({ ...field, containsPersonalData: checked });
              }}
            />
            Contains personal data
          </label>
          {showPersonalDataNotice ? (
            <p className="rounded-md border border-warning bg-warning-subtle p-3 text-xs text-warning-subtle-foreground">
              Answers to this question are subject to the organisation&apos;s data protection
              policy: they are included in exports and retained for as long as the process defines,
              per GOV-STANDARDS.md.
            </p>
          ) : null}
        </div>
      ) : null}

      {field.type !== 'heading' && field.type !== 'paragraph' ? (
        <div className="border-t border-divider pt-4">
          <ConditionEditor
            condition={field.visibleWhen}
            availableFields={otherFields}
            onChange={(condition) => onChange({ ...field, visibleWhen: condition })}
          />
        </div>
      ) : null}
    </div>
  );
}
