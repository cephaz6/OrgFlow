'use client';

import type { FieldType, FormSection, ProcessDefinitionDocument } from '@orgflow/types';
import { Alert, Button, cn } from '@orgflow/ui';
import { useMemo, useState } from 'react';

import { publishDraft, saveDraft } from './api-client';
import { useAnnouncer, LiveRegion } from './announcer';
import { Canvas, type CanvasSelection } from './canvas';
import type { DraftDetail } from './types';
import { blankField } from './field-defaults';
import {
  addField,
  addSection,
  keyFrom,
  moveFieldToSection,
  moveFieldWithinSection,
  moveSection,
  reorderFieldWithinSection,
  removeField,
  removeSection,
  updateField,
  updateSection,
} from './document-ops';
import { DocumentProperties, type DocumentSettings } from './document-properties';
import { FieldProperties } from './field-properties';
import { LivePreview } from './live-preview';
import { Palette } from './palette';
import { SectionProperties } from './section-properties';
import { hasBlockingIssues, validateDraft } from './validation';
import { ValidationPanel } from './validation-panel';
import {
  hasBlockingIssues as hasBlockingWorkflowIssues,
  validateWorkflow,
  ValidationPanel as WorkflowValidationPanel,
  WorkflowEditor,
} from '../workflow-builder';

export interface BuilderProps {
  initial: DraftDetail;
  userId: string;
}

type View = 'build' | 'workflow' | 'preview' | 'validate';

type SaveStatus =
  { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

function toBody(document: ProcessDefinitionDocument, settings: DocumentSettings) {
  return {
    name: settings.name,
    ...(settings.description !== undefined ? { description: settings.description } : {}),
    ...(settings.category !== undefined ? { category: settings.category } : {}),
    ...(document.icon !== undefined ? { icon: document.icon } : {}),
    form: { titleFieldKey: settings.titleFieldKey, sections: document.form.sections },
    workflow: document.workflow,
    ...(document.notifications !== undefined ? { notifications: document.notifications } : {}),
    ...(document.retentionDays !== undefined ? { retentionDays: document.retentionDays } : {}),
  };
}

export function Builder({ initial, userId }: BuilderProps) {
  const [definitionId] = useState(initial.definition.definitionId);
  const [document, setDocument] = useState(initial.document);
  const [settings, setSettings] = useState<DocumentSettings>({
    name: initial.document.name,
    ...(initial.document.description !== undefined
      ? { description: initial.document.description }
      : {}),
    ...(initial.document.category !== undefined ? { category: initial.document.category } : {}),
    titleFieldKey: initial.document.form.titleFieldKey,
  });
  const [version, setVersion] = useState(initial.version);
  const [selection, setSelection] = useState<CanvasSelection>(null);
  const [view, setView] = useState<View>('build');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: 'idle' });
  const [dirty, setDirty] = useState(false);
  const { announcedText, announce } = useAnnouncer();

  const sections = document.form.sections;
  const allFields = useMemo(() => sections.flatMap((section) => section.fields), [sections]);
  const issues = useMemo(
    () =>
      validateDraft({
        form: { ...document.form, sections, titleFieldKey: settings.titleFieldKey },
      }),
    [document.form, sections, settings.titleFieldKey],
  );
  const workflowIssues = useMemo(
    () => validateWorkflow({ workflow: document.workflow }),
    [document.workflow],
  );
  const totalIssueCount = issues.length + workflowIssues.length;
  const blocking = hasBlockingIssues(issues) || hasBlockingWorkflowIssues(workflowIssues);

  function withSections(next: FormSection[]) {
    setDocument((current) => ({ ...current, form: { ...current.form, sections: next } }));
    setDirty(true);
  }

  function targetSectionKey(): string | null {
    if (selection?.kind === 'section') return selection.sectionKey;
    if (selection?.kind === 'field') return selection.sectionKey;
    return sections.length > 0 ? sections[sections.length - 1]!.key : null;
  }

  function handleAddSection() {
    const key = keyFrom(
      'section',
      sections.map((s) => s.key),
    );
    const section: FormSection = { key, title: 'New section', fields: [] };
    withSections(addSection(sections, section));
    setSelection({ kind: 'section', sectionKey: key });
    announce('Added a new section.');
  }

  function handleAddField(type: FieldType) {
    const sectionKey = targetSectionKey();
    if (!sectionKey) return;
    const key = keyFrom(
      type,
      allFields.map((f) => f.key),
    );
    const field = blankField(type, key, `New ${type} field`);
    withSections(addField(sections, sectionKey, field));
    setSelection({ kind: 'field', sectionKey, fieldKey: key });
    announce(`Added a field to the form.`);
  }

  async function handleSave() {
    setSaveStatus({ kind: 'saving' });
    try {
      const result = await saveDraft(definitionId, toBody(document, settings));
      setVersion(result.version);
      setDirty(false);
      setSaveStatus({ kind: 'saved' });
    } catch (err) {
      setSaveStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'The draft could not be saved.',
      });
    }
  }

  async function handlePublish() {
    setSaveStatus({ kind: 'saving' });
    try {
      const saved = await saveDraft(definitionId, toBody(document, settings));
      setVersion(saved.version);
      setDirty(false);
      const published = await publishDraft(definitionId);
      setVersion({ ...published.version });
      setSaveStatus({ kind: 'saved' });
    } catch (err) {
      setSaveStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'The draft could not be published.',
      });
    }
  }

  const selectedSection =
    selection?.kind === 'section'
      ? sections.find((s) => s.key === selection.sectionKey)
      : undefined;
  const selectedField =
    selection?.kind === 'field'
      ? sections
          .find((s) => s.key === selection.sectionKey)
          ?.fields.find((f) => f.key === selection.fieldKey)
      : undefined;
  const selectedFieldSection =
    selection?.kind === 'field' ? sections.find((s) => s.key === selection.sectionKey) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <LiveRegion text={announcedText} />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
        <div role="tablist" aria-label="Builder view" className="flex gap-1">
          {(['build', 'workflow', 'preview', 'validate'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`tab-${tab}`}
              aria-selected={view === tab}
              aria-controls={`panel-${tab}`}
              onClick={() => setView(tab)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium capitalize',
                view === tab
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent',
              )}
            >
              {tab === 'validate' && totalIssueCount > 0 ? `Validate (${totalIssueCount})` : tab}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {version.status === 'published' ? (
            <span className="text-xs text-muted-foreground">
              Published as v{version.versionNumber}. Saving opens a new draft.
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              Draft v{version.versionNumber}
              {dirty ? ' · unsaved changes' : ''}
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleSave()}
            disabled={saveStatus.kind === 'saving'}
          >
            {saveStatus.kind === 'saving' ? 'Saving...' : 'Save draft'}
          </Button>
          <Button
            type="button"
            onClick={() => void handlePublish()}
            disabled={saveStatus.kind === 'saving' || blocking}
            title={
              blocking ? 'Resolve the errors in the Validate tab before publishing.' : undefined
            }
          >
            Publish
          </Button>
        </div>
      </div>

      {saveStatus.kind === 'error' ? (
        <Alert variant="destructive">{saveStatus.message}</Alert>
      ) : null}

      <div id="panel-build" role="tabpanel" aria-labelledby="tab-build" hidden={view !== 'build'}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr_320px]">
          <div className="rounded-lg border border-border bg-card p-4">
            <Palette
              targetSectionTitle={sections.find((s) => s.key === targetSectionKey())?.title ?? null}
              onAdd={handleAddField}
            />
          </div>

          <Canvas
            sections={sections}
            selection={selection}
            onSelect={setSelection}
            onReorderSections={withSections}
            onMoveSection={(key, direction) => withSections(moveSection(sections, key, direction))}
            onReorderFields={(sectionKey, from, to) =>
              withSections(reorderFieldWithinSection(sections, sectionKey, from, to))
            }
            onMoveField={(sectionKey, fieldKey, direction) =>
              withSections(moveFieldWithinSection(sections, sectionKey, fieldKey, direction))
            }
            onMoveFieldToSection={(sectionKey, fieldKey, toSectionKey) =>
              withSections(moveFieldToSection(sections, sectionKey, fieldKey, toSectionKey))
            }
            onDeleteSection={(key) => {
              withSections(removeSection(sections, key));
              if (selection?.kind === 'section' && selection.sectionKey === key) setSelection(null);
              announce('Removed section.');
            }}
            onDeleteField={(sectionKey, fieldKey) => {
              withSections(removeField(sections, sectionKey, fieldKey));
              if (selection?.kind === 'field' && selection.fieldKey === fieldKey)
                setSelection(null);
              announce('Removed field.');
            }}
            onAddSection={handleAddSection}
            announce={announce}
          />

          <div className="rounded-lg border border-border bg-card p-4">
            {selectedField && selectedFieldSection ? (
              <FieldProperties
                field={selectedField}
                otherFields={allFields.filter((f) => f.key !== selectedField.key)}
                onChange={(next) =>
                  withSections(
                    updateField(sections, selectedFieldSection.key, selectedField.key, next),
                  )
                }
                onDelete={() => {
                  withSections(removeField(sections, selectedFieldSection.key, selectedField.key));
                  setSelection(null);
                  announce('Removed field.');
                }}
              />
            ) : selectedSection ? (
              <SectionProperties
                section={selectedSection}
                availableFields={allFields}
                onChange={(next) => withSections(updateSection(sections, next))}
                onDelete={() => {
                  withSections(removeSection(sections, selectedSection.key));
                  setSelection(null);
                  announce('Removed section.');
                }}
              />
            ) : (
              <DocumentProperties
                settings={settings}
                allFields={allFields}
                onChange={setSettings}
              />
            )}
          </div>
        </div>
      </div>

      <div
        id="panel-workflow"
        role="tabpanel"
        aria-labelledby="tab-workflow"
        hidden={view !== 'workflow'}
      >
        <WorkflowEditor
          workflow={document.workflow}
          formFields={allFields}
          onChange={(workflow) => {
            setDocument((current) => ({ ...current, workflow }));
            setDirty(true);
          }}
          announce={announce}
        />
      </div>

      <div
        id="panel-preview"
        role="tabpanel"
        aria-labelledby="tab-preview"
        hidden={view !== 'preview'}
      >
        <LivePreview sections={sections} userId={userId} />
      </div>

      <div
        id="panel-validate"
        role="tabpanel"
        aria-labelledby="tab-validate"
        hidden={view !== 'validate'}
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Form</h2>
            <ValidationPanel issues={issues} />
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Workflow</h2>
            <WorkflowValidationPanel issues={workflowIssues} />
          </div>
        </div>
      </div>
    </div>
  );
}
