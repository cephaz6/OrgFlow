'use client';

import type { FormField, ProcessDefinitionDocument, WorkflowStep } from '@orgflow/types';
import { cn } from '@orgflow/ui';
import { useState } from 'react';

import { Canvas } from './canvas';
import { addStep, moveStep, removeStep, stepKeyFrom, updateStep } from './document-ops';
import { blankStep } from './step-defaults';
import { StepList } from './step-list';
import { StepPanel } from './step-panel';

export interface WorkflowEditorProps {
  workflow: ProcessDefinitionDocument['workflow'];
  formFields: FormField[];
  onChange: (workflow: ProcessDefinitionDocument['workflow']) => void;
  announce: (message: string) => void;
}

type View = 'canvas' | 'list';

// The composed workflow tab: a view switcher over the same steps array and
// the same selection, so the canvas and the list view are two renderings
// of one piece of state rather than two things that could disagree.
// StepPanel, the actual editor, sits beside either view unchanged.
export function WorkflowEditor({ workflow, formFields, onChange, announce }: WorkflowEditorProps) {
  const [view, setView] = useState<View>('list');
  const [selectedStepKey, setSelectedStepKey] = useState<string | null>(null);

  const { steps, startStepKey } = workflow;
  const selectedStep = steps.find((step) => step.key === selectedStepKey) ?? null;
  const personFields = formFields.filter((field) => field.type === 'user');

  function withSteps(next: WorkflowStep[]) {
    onChange({ ...workflow, steps: next });
  }

  function handleAddStep() {
    const key = stepKeyFrom(
      'Step',
      steps.map((s) => s.key),
    );
    const step = blankStep(key, 'New step', 'approval');
    const nextSteps = addStep(steps, step);
    // The first step in an empty workflow becomes the start step; without
    // this, a fresh workflow would need a second, easy-to-miss action
    // before a submitted request could ever reach it.
    onChange(
      steps.length === 0
        ? { startStepKey: key, steps: nextSteps }
        : { ...workflow, steps: nextSteps },
    );
    setSelectedStepKey(key);
    announce('Added a new step.');
  }

  function handleSetStart(stepKey: string) {
    onChange({ ...workflow, startStepKey: stepKey });
    announce('Changed the start step.');
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Workflow view"
        className="flex gap-1 self-start rounded-lg border border-border bg-card p-1"
      >
        {(['list', 'canvas'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={view === tab}
            onClick={() => setView(tab)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium capitalize',
              view === tab
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <div>
          {view === 'canvas' ? (
            <Canvas
              steps={steps}
              startStepKey={startStepKey}
              selectedStepKey={selectedStepKey}
              onSelect={setSelectedStepKey}
            />
          ) : (
            <StepList
              steps={steps}
              startStepKey={startStepKey}
              selectedStepKey={selectedStepKey}
              onSelect={setSelectedStepKey}
              onMoveStep={(key, direction) => withSteps(moveStep(steps, key, direction))}
              onDeleteStep={(key) => {
                withSteps(removeStep(steps, key));
                if (selectedStepKey === key) {
                  setSelectedStepKey(null);
                }
                announce('Removed step.');
              }}
              onSetStart={handleSetStart}
              onAddStep={handleAddStep}
            />
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          {selectedStep ? (
            <StepPanel
              step={selectedStep}
              otherStepKeys={steps.filter((s) => s.key !== selectedStep.key).map((s) => s.key)}
              personFields={personFields}
              formFields={formFields}
              onChange={(next) => withSteps(updateStep(steps, selectedStep.key, next))}
              onDelete={() => {
                withSteps(removeStep(steps, selectedStep.key));
                setSelectedStepKey(null);
                announce('Removed step.');
              }}
              onSetAsStart={() => handleSetStart(selectedStep.key)}
              isStart={selectedStep.key === startStepKey}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {steps.length === 0
                ? 'Add a step to start building the workflow. Until then, a submitted request completes immediately.'
                : 'Select a step to edit it.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
