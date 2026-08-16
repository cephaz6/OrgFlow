'use client';

import type { FormField } from '@orgflow/types';
import { Input, Label, Select, Textarea } from '@orgflow/ui';
import { useId } from 'react';

import { withOptional } from '../../lib/optional';

export interface DocumentSettings {
  name: string;
  description?: string;
  category?: string;
  titleFieldKey: string;
}

export interface DocumentPropertiesProps {
  settings: DocumentSettings;
  allFields: FormField[];
  onChange: (settings: DocumentSettings) => void;
}

// Shown in the properties pane when nothing on the canvas is selected: the
// document-level settings, including which field titles a case built from
// this form (form.titleFieldKey), which has no other natural home since it
// is not a property of any one section or field.
export function DocumentProperties({ settings, allFields, onChange }: DocumentPropertiesProps) {
  const idPrefix = useId();

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Process</p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <Input
          id={`${idPrefix}-name`}
          value={settings.name}
          onChange={(event) => onChange({ ...settings, name: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-description`}>Description</Label>
        <Textarea
          id={`${idPrefix}-description`}
          value={settings.description ?? ''}
          onChange={(event) =>
            onChange(withOptional(settings, 'description', event.target.value || undefined))
          }
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-category`}>Category</Label>
        <Input
          id={`${idPrefix}-category`}
          value={settings.category ?? ''}
          onChange={(event) =>
            onChange(withOptional(settings, 'category', event.target.value || undefined))
          }
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-title-field`}>Title field</Label>
        <p className="text-xs text-muted-foreground">
          Which answer names a request built from this form, shown wherever a case is listed.
        </p>
        <Select
          id={`${idPrefix}-title-field`}
          value={settings.titleFieldKey}
          onChange={(event) => onChange({ ...settings, titleFieldKey: event.target.value })}
        >
          <option value="">None (use the process name)</option>
          {allFields.map((field) => (
            <option key={field.key} value={field.key}>
              {field.label || field.key}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
