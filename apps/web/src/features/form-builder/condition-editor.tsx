'use client';

import type { Condition, ConditionOperator, FormField } from '@orgflow/types';
import { Input, Label, Select } from '@orgflow/ui';

import { coerceValue } from './condition-value';

export interface ConditionEditorProps {
  condition: Condition | null | undefined;
  // Every field on the form this condition could reference, so the picker
  // only ever offers a key that actually exists.
  availableFields: FormField[];
  onChange: (condition: Condition | null) => void;
}

const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  eq: 'is',
  neq: 'is not',
  gt: 'is greater than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  in: 'is one of',
  notIn: 'is not one of',
  contains: 'contains',
  notContains: 'does not contain',
  startsWith: 'starts with',
  endsWith: 'ends with',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
  isTrue: 'is checked',
  isFalse: 'is not checked',
};

const OPERATORS = Object.keys(OPERATOR_LABELS) as ConditionOperator[];

const NO_VALUE_OPERATORS = new Set<ConditionOperator>([
  'isEmpty',
  'isNotEmpty',
  'isTrue',
  'isFalse',
]);

export function ConditionEditor({ condition, availableFields, onChange }: ConditionEditorProps) {
  const isSimple = condition === null || condition === undefined || 'field' in condition;
  const active = isSimple ? (condition ?? null) : null;

  function setEnabled(enabled: boolean) {
    if (!enabled) {
      onChange(null);
      return;
    }
    const first = availableFields[0];
    onChange(first ? { field: first.key, operator: 'eq', value: '' } : null);
  }

  if (!isSimple) {
    return (
      <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
        This condition was set up outside the builder and cannot be edited here without replacing
        it.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={active !== null}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Only show when a condition is met
      </label>

      {active ? (
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="condition-field">Field</Label>
            <Select
              id="condition-field"
              value={active.field}
              onChange={(event) => {
                // Re-coerce against the newly chosen field: a threshold
                // typed for a text field is a string, and pointing the same
                // condition at a number field would otherwise leave it one.
                const next = availableFields.find((field) => field.key === event.target.value);
                onChange({
                  ...active,
                  field: event.target.value,
                  value: coerceValue(String(active.value ?? ''), next),
                });
              }}
            >
              {availableFields.map((field) => (
                <option key={field.key} value={field.key}>
                  {field.label || field.key}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="condition-operator">Condition</Label>
            <Select
              id="condition-operator"
              value={active.operator}
              onChange={(event) =>
                onChange({ ...active, operator: event.target.value as ConditionOperator })
              }
            >
              {OPERATORS.map((operator) => (
                <option key={operator} value={operator}>
                  {OPERATOR_LABELS[operator]}
                </option>
              ))}
            </Select>
          </div>

          {!NO_VALUE_OPERATORS.has(active.operator) ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="condition-value">Value</Label>
              <Input
                id="condition-value"
                value={typeof active.value === 'string' ? active.value : String(active.value ?? '')}
                onChange={(event) =>
                  onChange({
                    ...active,
                    value: coerceValue(
                      event.target.value,
                      availableFields.find((field) => field.key === active.field),
                    ),
                  })
                }
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
