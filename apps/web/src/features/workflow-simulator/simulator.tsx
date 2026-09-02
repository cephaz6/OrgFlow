'use client';

import type { ProcessDefinitionDocument, WorkflowDecisionAction } from '@orgflow/types';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle } from '@orgflow/ui';
import { Play, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';

// Deep imports rather than the features/cases barrel, which also re-exports
// api-server.ts and would drag next/headers into this 'use client' bundle.
// live-preview.tsx reaches past the same barrel for the same two modules and
// for the same reason.
import { FieldInput } from '../cases/field-input';
import { visibleFields, visibleSections, type VisibilityInput } from '../cases/visibility';
import { ContextPanel } from './context-panel';
import {
  buildContext,
  decide,
  groupIdsFromDefinition,
  isFinished,
  startSimulation,
  type SimulationContextInput,
  type SimulationState,
} from './simulate';
import { OutcomeBadge, TraceView } from './trace-view';

export interface SimulatorProps {
  document: ProcessDefinitionDocument;
  userId: string;
}

const DEFAULT_CONTEXT: SimulationContextInput = {
  department: 'Engineering',
  roles: ['member'],
  hasLineManager: true,
  now: '',
};

// ADR-0040. Nothing here is persisted: the engine returns what should
// happen and this component simply never does any of it.
export function Simulator({ document, userId }: SimulatorProps) {
  const [contextInput, setContextInput] = useState<SimulationContextInput>(DEFAULT_CONTEXT);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [run, setRun] = useState<SimulationState | null>(null);

  const sections = document.form.sections;
  const hasWorkflow = document.workflow.steps.length > 0;

  const stepNamesByKey = useMemo(
    () =>
      Object.fromEntries(document.workflow.steps.map((step) => [step.key, step.name])) as Record<
        string,
        string
      >,
    [document.workflow.steps],
  );

  const groupKeysById = useMemo(() => {
    const ids = groupIdsFromDefinition(document);
    return Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key]));
  }, [document]);

  // The form preview needs a clock for its own visibility conditions, and
  // the simulation needs one to compute deadlines from. They are the same
  // clock, fixed when a run starts so a trace does not drift as it is read.
  const [previewNow] = useState(() => new Date().toISOString());
  const visibility: VisibilityInput = {
    values,
    roles: contextInput.roles,
    userId,
    now: previewNow,
  };
  const shownSections = visibleSections(sections, visibility);

  const running = run !== null;
  const finished = run !== null && isFinished(run);

  function handleStart() {
    const now = new Date().toISOString();
    const input = { ...contextInput, now };
    setContextInput(input);
    setRun(startSimulation(document, values, buildContext(input, document)));
  }

  function handleDecision(taskId: string, decision: WorkflowDecisionAction) {
    setRun((current) =>
      current === null
        ? current
        : decide(current, document, values, buildContext(contextInput, document), taskId, decision),
    );
  }

  if (!hasWorkflow) {
    return (
      <Alert>
        There is no workflow to simulate yet. Add at least one step on the Workflow tab, then come
        back to watch a request move through it.
      </Alert>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Simulate as</CardTitle>
            <p className="text-sm text-muted-foreground">
              A hypothetical requester. Nothing here is saved, and no request is created.
            </p>
          </CardHeader>
          <CardContent>
            <ContextPanel value={contextInput} disabled={running} onChange={setContextInput} />
          </CardContent>
        </Card>

        {shownSections.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Their answers</CardTitle>
            </CardHeader>
            <CardContent>
              {/* A native disabled fieldset rather than a prop on every
                  input: FieldInput is the case runtime's own component and
                  has no reason to grow a `disabled` prop for this one
                  caller, and the browser already cascades the attribute to
                  every control inside. */}
              <fieldset disabled={running} className="flex flex-col gap-5 border-0 p-0">
                {shownSections.map((section) =>
                  visibleFields(section, visibility).map((field) => (
                    <FieldInput
                      key={field.key}
                      field={field}
                      value={values[field.key]}
                      error={undefined}
                      // The preview tab renders this same form and stays
                      // mounted alongside this one, so both copies would
                      // otherwise emit the same DOM ids and the second
                      // control would lose its label entirely.
                      idPrefix="sim"
                      onChange={(value) =>
                        setValues((current) => ({ ...current, [field.key]: value }))
                      }
                    />
                  )),
                )}
              </fieldset>
            </CardContent>
          </Card>
        ) : null}

        <div className="flex gap-2">
          <Button type="button" onClick={handleStart} disabled={running}>
            <Play aria-hidden="true" className="h-4 w-4" />
            Run simulation
          </Button>
          {running ? (
            <Button type="button" variant="outline" onClick={() => setRun(null)}>
              <RotateCcw aria-hidden="true" className="h-4 w-4" />
              Reset
            </Button>
          ) : null}
        </div>
        {running ? (
          <p className="text-xs text-muted-foreground">
            Reset to change the requester or their answers, so the trace always reflects one
            consistent request.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <p aria-live="polite" className="text-sm">
          {run === null ? (
            <span className="text-muted-foreground">
              Describe a requester, then run the simulation to watch the engine route their request.
            </span>
          ) : finished ? (
            <span className="flex items-center gap-2">
              <span className="text-muted-foreground">Finished:</span>
              <OutcomeBadge status={run.caseState.status} />
            </span>
          ) : (
            <span>
              Waiting on{' '}
              <span className="font-medium">
                {run.openTasks.map((task) => task.spec.stepName).join(', ')}
              </span>
              . Choose what that person does.
            </span>
          )}
        </p>

        {run !== null && !finished ? (
          <div className="flex flex-col gap-3">
            {run.openTasks.map((task) => (
              <div
                key={task.taskId}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-primary p-3"
              >
                <span className="text-sm font-medium">{task.spec.stepName}:</span>
                {task.spec.allowedDecisions.map((decision) => (
                  <Button
                    key={decision}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleDecision(task.taskId, decision)}
                  >
                    {decision}
                  </Button>
                ))}
              </div>
            ))}
          </div>
        ) : null}

        {run !== null ? (
          <TraceView
            entries={run.entries}
            groupKeysById={groupKeysById}
            stepNamesByKey={stepNamesByKey}
          />
        ) : null}
      </div>
    </div>
  );
}
