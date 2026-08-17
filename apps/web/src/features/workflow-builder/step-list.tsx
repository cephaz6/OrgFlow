'use client';

import type { WorkflowStep } from '@orgflow/types';
import { Button, cn } from '@orgflow/ui';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';

import { STEP_TYPE_LABELS } from './step-defaults';

export interface StepListProps {
  steps: WorkflowStep[];
  startStepKey: string;
  selectedStepKey: string | null;
  onSelect: (stepKey: string) => void;
  onMoveStep: (stepKey: string, direction: -1 | 1) => void;
  onDeleteStep: (stepKey: string) => void;
  onSetStart: (stepKey: string) => void;
  onAddStep: () => void;
}

// PRD.md §13.2: the workflow builder's canvas needs a keyboard alternative
// that is fully operable without it, not merely a keyboard-navigable
// version of the same canvas. This is that: every step, in document order,
// editable and reorderable with ordinary buttons, next to the same
// StepPanel the canvas selection opens. Nothing here requires a pointer or
// a drag gesture.
export function StepList({
  steps,
  startStepKey,
  selectedStepKey,
  onSelect,
  onMoveStep,
  onDeleteStep,
  onSetStart,
  onAddStep,
}: StepListProps) {
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col gap-2">
        {steps.map((step, index) => {
          const isSelected = step.key === selectedStepKey;
          const isStart = step.key === startStepKey;
          return (
            <li
              key={step.key}
              className={cn(
                'flex items-center gap-2 rounded-md border bg-card p-2',
                isSelected ? 'border-primary' : 'border-border',
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(step.key)}
                className="flex flex-1 flex-col items-start text-left"
              >
                <span className="text-sm">
                  {step.name}
                  {isStart ? (
                    <span className="ms-2 text-xs text-muted-foreground">(start)</span>
                  ) : null}
                </span>
                <span className="text-xs text-muted-foreground">{STEP_TYPE_LABELS[step.type]}</span>
              </button>

              {!isStart ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onSetStart(step.key)}
                >
                  Make start
                </Button>
              ) : null}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Move "${step.name}" up`}
                disabled={index === 0}
                onClick={() => onMoveStep(step.key, -1)}
              >
                <ChevronUp aria-hidden="true" className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Move "${step.name}" down`}
                disabled={index === steps.length - 1}
                onClick={() => onMoveStep(step.key, 1)}
              >
                <ChevronDown aria-hidden="true" className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove "${step.name}"`}
                onClick={() => onDeleteStep(step.key)}
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
              </Button>
            </li>
          );
        })}
      </ol>

      {steps.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No steps yet. A workflow with no steps completes immediately.
        </p>
      ) : null}

      <Button type="button" variant="outline" onClick={onAddStep} className="self-start">
        <Plus aria-hidden="true" className="h-4 w-4" />
        Add step
      </Button>
    </div>
  );
}
