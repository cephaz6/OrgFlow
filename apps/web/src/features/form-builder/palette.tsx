'use client';

import type { FieldType } from '@orgflow/types';
import { Button } from '@orgflow/ui';

import { FIELD_TYPE_LABELS, FIELD_TYPE_ORDER } from './field-defaults';

export interface PaletteProps {
  targetSectionTitle: string | null;
  onAdd: (type: FieldType) => void;
}

// The left pane. Every button adds a field to whichever section is
// currently selected on the canvas (or the last one, if a field within it
// is selected); there is no drag-from-palette interaction; PRD.md §13.2
// asks for a palette, not specifically a draggable one, and a click is the
// same action with no keyboard-only fallback to build separately.
export function Palette({ targetSectionTitle, onAdd }: PaletteProps) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Add a field
      </p>
      <p className="text-xs text-muted-foreground">
        {targetSectionTitle ? `Adds to "${targetSectionTitle}".` : 'Select or add a section first.'}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {FIELD_TYPE_ORDER.map((type) => (
          <Button
            key={type}
            type="button"
            variant="outline"
            size="sm"
            disabled={!targetSectionTitle}
            onClick={() => onAdd(type)}
            className="h-auto min-h-9 justify-start whitespace-normal py-2 text-left leading-snug"
          >
            {FIELD_TYPE_LABELS[type]}
          </Button>
        ))}
      </div>
    </div>
  );
}
