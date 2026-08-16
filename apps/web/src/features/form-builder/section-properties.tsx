'use client';

import type { FormField, FormSection } from '@orgflow/types';
import { Button, Input, Label, Textarea } from '@orgflow/ui';
import { Trash2 } from 'lucide-react';
import { useId } from 'react';

import { withOptional } from '../../lib/optional';
import { ConditionEditor } from './condition-editor';

export interface SectionPropertiesProps {
  section: FormSection;
  availableFields: FormField[];
  onChange: (section: FormSection) => void;
  onDelete: () => void;
}

export function SectionProperties({
  section,
  availableFields,
  onChange,
  onDelete,
}: SectionPropertiesProps) {
  const idPrefix = useId();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Section
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onDelete}>
          <Trash2 aria-hidden="true" className="h-4 w-4" />
          Remove
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-title`}>Section title</Label>
        <Input
          id={`${idPrefix}-title`}
          value={section.title}
          onChange={(event) => onChange({ ...section, title: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-description`}>Description (optional)</Label>
        <Textarea
          id={`${idPrefix}-description`}
          value={section.description ?? ''}
          onChange={(event) =>
            onChange(withOptional(section, 'description', event.target.value || undefined))
          }
        />
      </div>

      <div className="border-t border-divider pt-4">
        <ConditionEditor
          condition={section.visibleWhen}
          availableFields={availableFields}
          onChange={(condition) => onChange({ ...section, visibleWhen: condition })}
        />
      </div>
    </div>
  );
}
