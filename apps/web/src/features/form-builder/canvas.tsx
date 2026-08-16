'use client';

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { FormField, FormSection } from '@orgflow/types';
import { Button, cn, Select } from '@orgflow/ui';
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from 'lucide-react';

import { FIELD_TYPE_LABELS } from './field-defaults';

export type CanvasSelection =
  | { kind: 'section'; sectionKey: string }
  | { kind: 'field'; sectionKey: string; fieldKey: string }
  | null;

export interface CanvasProps {
  sections: FormSection[];
  selection: CanvasSelection;
  onSelect: (selection: CanvasSelection) => void;
  onReorderSections: (next: FormSection[]) => void;
  onMoveSection: (sectionKey: string, direction: -1 | 1) => void;
  onReorderFields: (sectionKey: string, fromIndex: number, toIndex: number) => void;
  onMoveField: (sectionKey: string, fieldKey: string, direction: -1 | 1) => void;
  onMoveFieldToSection: (sectionKey: string, fieldKey: string, toSectionKey: string) => void;
  onDeleteSection: (sectionKey: string) => void;
  onDeleteField: (sectionKey: string, fieldKey: string) => void;
  onAddSection: () => void;
  announce: (message: string) => void;
}

const SECTION_PREFIX = 'section:';
const FIELD_PREFIX = 'field:';

function sectionDndId(sectionKey: string): string {
  return `${SECTION_PREFIX}${sectionKey}`;
}

function fieldDndId(sectionKey: string, fieldKey: string): string {
  return `${FIELD_PREFIX}${sectionKey}:${fieldKey}`;
}

export function Canvas(props: CanvasProps) {
  const { sections, onReorderSections, onReorderFields, onMoveFieldToSection, announce } = props;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const activeId = String(active.id);
    const overId = String(over.id);

    if (activeId.startsWith(SECTION_PREFIX) && overId.startsWith(SECTION_PREFIX)) {
      const from = sections.findIndex((s) => sectionDndId(s.key) === activeId);
      const to = sections.findIndex((s) => sectionDndId(s.key) === overId);
      if (from !== -1 && to !== -1) {
        onReorderSections(arrayMove(sections, from, to));
        announce(
          `Moved "${sections[from]!.title}" section to position ${to + 1} of ${sections.length}.`,
        );
      }
      return;
    }

    if (activeId.startsWith(FIELD_PREFIX) && overId.startsWith(FIELD_PREFIX)) {
      const [, activeSectionKey, activeFieldKey] = activeId.split(':') as [string, string, string];
      const [, overSectionKey, overFieldKey] = overId.split(':') as [string, string, string];
      if (activeSectionKey !== overSectionKey) {
        // Cross-section pointer drops are not supported; "Move to section"
        // below is the equivalent for that move, and it is reachable by
        // keyboard and pointer alike.
        return;
      }
      const section = sections.find((s) => s.key === activeSectionKey);
      if (!section) {
        return;
      }
      const from = section.fields.findIndex((f) => f.key === activeFieldKey);
      const to = section.fields.findIndex((f) => f.key === overFieldKey);
      if (from !== -1 && to !== -1) {
        onReorderFields(activeSectionKey, from, to);
        announce(
          `Moved "${section.fields[from]!.label || activeFieldKey}" to position ${to + 1} of ${section.fields.length} in "${section.title}".`,
        );
      }
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="flex flex-col gap-4">
        <SortableContext
          items={sections.map((s) => sectionDndId(s.key))}
          strategy={verticalListSortingStrategy}
        >
          {sections.map((section) => (
            <SectionBlock
              key={section.key}
              section={section}
              otherSections={sections.filter((s) => s.key !== section.key)}
              {...props}
              onReorderFields={onReorderFields}
              onMoveFieldToSection={onMoveFieldToSection}
            />
          ))}
        </SortableContext>

        {sections.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No sections yet. Add one to start building the form.
          </p>
        ) : null}

        <Button type="button" variant="outline" onClick={props.onAddSection} className="self-start">
          <Plus aria-hidden="true" className="h-4 w-4" />
          Add section
        </Button>
      </div>
    </DndContext>
  );
}

interface SectionBlockProps extends CanvasProps {
  section: FormSection;
  otherSections: FormSection[];
}

function SectionBlock({
  section,
  otherSections,
  selection,
  onSelect,
  onMoveSection,
  onMoveField,
  onMoveFieldToSection,
  onDeleteSection,
  onDeleteField,
  announce,
  sections,
}: SectionBlockProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sectionDndId(section.key),
  });

  const style = { transform: CSS.Transform.toString(transform), transition };
  const isSelected = selection?.kind === 'section' && selection.sectionKey === section.key;
  const sectionIndex = sections.findIndex((s) => s.key === section.key);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'rounded-lg border bg-card',
        isSelected ? 'border-primary' : 'border-border',
        isDragging ? 'opacity-50' : undefined,
      )}
    >
      <div className="flex items-center gap-2 border-b border-divider p-3">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder "${section.title}" section`}
          className="cursor-grab rounded p-1 text-muted-foreground hover:bg-accent active:cursor-grabbing"
        >
          <GripVertical aria-hidden="true" className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => onSelect({ kind: 'section', sectionKey: section.key })}
          className="flex-1 truncate text-left text-sm font-medium"
        >
          {section.title}
        </button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Move "${section.title}" section up`}
          disabled={sectionIndex <= 0}
          onClick={() => {
            onMoveSection(section.key, -1);
            announce(`Moved "${section.title}" section up.`);
          }}
        >
          <ChevronUp aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Move "${section.title}" section down`}
          disabled={sectionIndex >= sections.length - 1}
          onClick={() => {
            onMoveSection(section.key, 1);
            announce(`Moved "${section.title}" section down.`);
          }}
        >
          <ChevronDown aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Remove "${section.title}" section`}
          onClick={() => onDeleteSection(section.key)}
        >
          <Trash2 aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-2 p-3">
        <SortableContext
          items={section.fields.map((f) => fieldDndId(section.key, f.key))}
          strategy={verticalListSortingStrategy}
        >
          {section.fields.map((field, index) => (
            <FieldRow
              key={field.key}
              field={field}
              section={section}
              index={index}
              fieldCount={section.fields.length}
              otherSections={otherSections}
              isSelected={selection?.kind === 'field' && selection.fieldKey === field.key}
              onSelect={() =>
                onSelect({ kind: 'field', sectionKey: section.key, fieldKey: field.key })
              }
              onMoveField={onMoveField}
              onMoveFieldToSection={onMoveFieldToSection}
              onDeleteField={onDeleteField}
              announce={announce}
            />
          ))}
        </SortableContext>
        {section.fields.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            No fields yet. Add one from the palette.
          </p>
        ) : null}
      </div>
    </div>
  );
}

interface FieldRowProps {
  field: FormField;
  section: FormSection;
  index: number;
  fieldCount: number;
  otherSections: FormSection[];
  isSelected: boolean;
  onSelect: () => void;
  onMoveField: (sectionKey: string, fieldKey: string, direction: -1 | 1) => void;
  onMoveFieldToSection: (sectionKey: string, fieldKey: string, toSectionKey: string) => void;
  onDeleteField: (sectionKey: string, fieldKey: string) => void;
  announce: (message: string) => void;
}

function FieldRow({
  field,
  section,
  index,
  fieldCount,
  otherSections,
  isSelected,
  onSelect,
  onMoveField,
  onMoveFieldToSection,
  onDeleteField,
  announce,
}: FieldRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: fieldDndId(section.key, field.key),
  });

  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 rounded-md border bg-background p-2',
        isSelected ? 'border-primary' : 'border-border',
        isDragging ? 'opacity-50' : undefined,
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder "${field.label || field.key}"`}
        className="cursor-grab rounded p-1 text-muted-foreground hover:bg-accent active:cursor-grabbing"
      >
        <GripVertical aria-hidden="true" className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={onSelect}
        className="flex flex-1 flex-col items-start text-left"
      >
        <span className="text-sm">{field.label || field.key}</span>
        <span className="text-xs text-muted-foreground">{FIELD_TYPE_LABELS[field.type]}</span>
      </button>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Move "${field.label || field.key}" up`}
        disabled={index <= 0}
        onClick={() => {
          onMoveField(section.key, field.key, -1);
          announce(`Moved "${field.label || field.key}" up.`);
        }}
      >
        <ChevronUp aria-hidden="true" className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Move "${field.label || field.key}" down`}
        disabled={index >= fieldCount - 1}
        onClick={() => {
          onMoveField(section.key, field.key, 1);
          announce(`Moved "${field.label || field.key}" down.`);
        }}
      >
        <ChevronDown aria-hidden="true" className="h-4 w-4" />
      </Button>

      {otherSections.length > 0 ? (
        <Select
          aria-label={`Move "${field.label || field.key}" to a different section`}
          value=""
          onChange={(event) => {
            const toSectionKey = event.target.value;
            if (!toSectionKey) {
              return;
            }
            const target = otherSections.find((s) => s.key === toSectionKey);
            onMoveFieldToSection(section.key, field.key, toSectionKey);
            announce(`Moved "${field.label || field.key}" to "${target?.title ?? toSectionKey}".`);
          }}
          className="h-9 w-36"
        >
          <option value="">Move to section...</option>
          {otherSections.map((s) => (
            <option key={s.key} value={s.key}>
              {s.title}
            </option>
          ))}
        </Select>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Remove "${field.label || field.key}"`}
        onClick={() => onDeleteField(section.key, field.key)}
      >
        <Trash2 aria-hidden="true" className="h-4 w-4" />
      </Button>
    </div>
  );
}
