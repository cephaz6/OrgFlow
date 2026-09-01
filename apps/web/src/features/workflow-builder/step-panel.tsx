'use client';

import type {
  AssignmentStrategy,
  FormField,
  StepType,
  WorkflowDecisionAction,
  WorkflowStep,
} from '@orgflow/types';
import { Button, Input, Label, Select, Textarea } from '@orgflow/ui';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { useId } from 'react';

// Deep import, not the feature barrel: features/form-builder/index.ts also
// re-exports api-server.ts (server-only), and this is a 'use client'
// component. Pulling the barrel in here would drag that server-only chain
// into the browser bundle the same way it did for the live preview before
// that was fixed the same way.
import { ConditionEditor } from '../form-builder/condition-editor';
import {
  addEscalationRule,
  addReminder,
  addTransitionRule,
  moveEscalationRule,
  moveTransitionRule,
  removeEscalationRule,
  removeReminder,
  removeTransitionRule,
  updateEscalationRule,
  updateReminder,
  updateTransitionRule,
} from './document-ops';
import {
  ASSIGNMENT_LABELS,
  DECISION_LABELS,
  DEFAULT_DECISIONS_BY_TYPE,
  STEP_TYPE_LABELS,
  TERMINAL_KEYS,
  TERMINAL_LABELS,
  type BuilderAssignmentStrategy,
} from './step-defaults';

// Mirrors packages/types/src/membership.ts's OrganisationRole, which is a
// type rather than a runtime value, so the option list has to be spelled
// out rather than imported.
const ORGANISATION_ROLES = ['member', 'approver', 'processOwner', 'admin', 'owner'];

const ASSIGNMENT_STRATEGIES: BuilderAssignmentStrategy[] = [
  'lineManager',
  'lineManagerOfAssignee',
  'submitter',
  'role',
  'group',
  'fieldReference',
];

export interface StepPanelProps {
  step: WorkflowStep;
  otherStepKeys: string[];
  personFields: FormField[];
  formFields: FormField[];
  onChange: (step: WorkflowStep) => void;
  onDelete: () => void;
  onSetAsStart: () => void;
  isStart: boolean;
}

function targetOptions(otherStepKeys: string[]): { value: string; label: string }[] {
  return [
    ...otherStepKeys.map((key) => ({ value: key, label: key })),
    ...TERMINAL_KEYS.map((key) => ({ value: key, label: TERMINAL_LABELS[key] })),
  ];
}

function AssignmentEditor({
  assignment,
  personFields,
  onChange,
}: {
  assignment: AssignmentStrategy;
  personFields: FormField[];
  onChange: (assignment: AssignmentStrategy) => void;
}) {
  const idPrefix = useId();
  // specificUser is not offered by this builder (see step-defaults.ts); a
  // document carrying one keeps it until this editor is opened for that
  // step, at which point it falls back to lineManager rather than crashing.
  const strategy: BuilderAssignmentStrategy =
    assignment.strategy === 'specificUser' ? 'lineManager' : assignment.strategy;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`${idPrefix}-strategy`}>Assigned to</Label>
      <Select
        id={`${idPrefix}-strategy`}
        value={strategy}
        onChange={(event) => {
          const next = event.target.value as BuilderAssignmentStrategy;
          if (next === 'role') {
            onChange({ strategy: 'role', role: ORGANISATION_ROLES[0]! });
          } else if (next === 'group') {
            onChange({ strategy: 'group', groupKey: '' });
          } else if (next === 'fieldReference') {
            onChange({ strategy: 'fieldReference', fieldKey: personFields[0]?.key ?? '' });
          } else {
            onChange({ strategy: next });
          }
        }}
      >
        {ASSIGNMENT_STRATEGIES.map((value) => (
          <option key={value} value={value}>
            {ASSIGNMENT_LABELS[value]}
          </option>
        ))}
      </Select>

      {assignment.strategy === 'role' ? (
        <Select
          aria-label="Role"
          value={assignment.role}
          onChange={(event) => onChange({ strategy: 'role', role: event.target.value })}
        >
          {ORGANISATION_ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </Select>
      ) : null}

      {assignment.strategy === 'group' ? (
        <Input
          aria-label="Group key"
          placeholder="e.g. itSupport"
          value={assignment.groupKey}
          onChange={(event) => onChange({ strategy: 'group', groupKey: event.target.value })}
        />
      ) : null}

      {assignment.strategy === 'fieldReference' ? (
        personFields.length > 0 ? (
          <Select
            aria-label="Person field"
            value={assignment.fieldKey}
            onChange={(event) =>
              onChange({ strategy: 'fieldReference', fieldKey: event.target.value })
            }
          >
            {personFields.map((field) => (
              <option key={field.key} value={field.key}>
                {field.label || field.key}
              </option>
            ))}
          </Select>
        ) : (
          <p className="text-sm text-muted-foreground">
            Add a "Person" field to the form first, so this step can point at it.
          </p>
        )
      ) : null}
    </div>
  );
}

function DecisionTransitions({
  step,
  decision,
  otherStepKeys,
  formFields,
  onChange,
}: {
  step: WorkflowStep;
  decision: WorkflowDecisionAction;
  otherStepKeys: string[];
  formFields: FormField[];
  onChange: (step: WorkflowStep) => void;
}) {
  const rules = step.transitions[decision] ?? [];
  const hasDefault = rules.length > 0 && rules[rules.length - 1]!.when === null;
  const options = targetOptions(otherStepKeys);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <p className="text-sm font-medium">{DECISION_LABELS[decision]} goes to</p>
      {rules.map((rule, index) => (
        <div key={index} className="flex flex-col gap-2 rounded-md border border-divider p-2">
          <div className="flex items-center gap-2">
            <Select
              aria-label={`Where "${DECISION_LABELS[decision]}" rule ${index + 1} goes`}
              value={rule.to}
              onChange={(event) =>
                onChange(
                  updateTransitionRule(step, decision, index, { ...rule, to: event.target.value }),
                )
              }
              className="flex-1"
            >
              <option value="">Choose a step or outcome</option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Move rule ${index + 1} up`}
              disabled={index === 0}
              onClick={() => onChange(moveTransitionRule(step, decision, index, -1))}
            >
              <ChevronUp aria-hidden="true" className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Move rule ${index + 1} down`}
              disabled={index === rules.length - 1}
              onClick={() => onChange(moveTransitionRule(step, decision, index, 1))}
            >
              <ChevronDown aria-hidden="true" className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove rule ${index + 1}`}
              onClick={() => onChange(removeTransitionRule(step, decision, index))}
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            </Button>
          </div>
          {rule.when === null ? (
            <p className="text-xs text-muted-foreground">
              Default: matches whenever nothing above it did.
            </p>
          ) : (
            <ConditionEditor
              condition={rule.when}
              availableFields={formFields}
              onChange={(condition) =>
                onChange(
                  updateTransitionRule(step, decision, index, {
                    ...rule,
                    when: condition ?? { field: '', operator: 'eq', value: '' },
                  }),
                )
              }
            />
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange(
              addTransitionRule(step, decision, {
                when: { field: '', operator: 'eq', value: '' },
                to: options[0]?.value ?? '$completed',
              }),
            )
          }
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Add condition
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={hasDefault}
          onClick={() =>
            onChange(
              addTransitionRule(step, decision, {
                when: null,
                to: options[0]?.value ?? '$completed',
              }),
            )
          }
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Add default
        </Button>
      </div>
    </div>
  );
}

// A step with a durationHours can additionally warn ahead of the deadline
// (reminders) and add further assignees once it is missed (escalation),
// per PRD.md §15.2-15.3. Both stay hidden until an SLA exists, since neither
// means anything without a dueAt to count from.
function SlaTimersEditor({
  step,
  sla,
  personFields,
  onChange,
}: {
  step: WorkflowStep;
  sla: NonNullable<WorkflowStep['sla']>;
  personFields: FormField[];
  onChange: (step: WorkflowStep) => void;
}) {
  const stepWithSla = { ...step, sla };
  const escalation = sla.escalation ?? [];

  return (
    <div className="flex flex-col gap-4 border-t border-divider pt-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={sla.businessHoursOnly !== false}
          onChange={(event) => {
            if (event.target.checked) {
              const { businessHoursOnly: _drop, ...rest } = sla;
              onChange({ ...step, sla: rest });
            } else {
              onChange({ ...step, sla: { ...sla, businessHoursOnly: false } });
            }
          }}
        />
        Skip weekends when calculating the deadline
      </label>

      <div className="flex flex-col gap-2">
        <Label>Reminders</Label>
        {(sla.reminders ?? []).map((reminder, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              aria-label={`Reminder ${index + 1}, hours before the deadline`}
              type="number"
              min={1}
              className="w-24"
              value={reminder.atHoursBefore}
              onChange={(event) =>
                onChange(
                  updateReminder(stepWithSla, index, {
                    atHoursBefore: Number(event.target.value),
                  }),
                )
              }
            />
            <span className="text-sm text-muted-foreground">hours before the deadline</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove reminder ${index + 1}`}
              onClick={() => onChange(removeReminder(stepWithSla, index))}
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange(addReminder(stepWithSla, { atHoursBefore: 24 }))}
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Add reminder
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Escalation</Label>
        {escalation.map((rule, index) => (
          <div key={index} className="flex flex-col gap-2 rounded-md border border-divider p-3">
            <p className="text-sm font-medium">Level {index + 1}</p>
            <AssignmentEditor
              assignment={rule}
              personFields={personFields}
              onChange={(assignment) =>
                onChange(
                  updateEscalationRule(stepWithSla, index, {
                    ...assignment,
                    atHoursAfter: rule.atHoursAfter,
                  }),
                )
              }
            />
            <div className="flex items-center gap-2">
              <Input
                aria-label={`Level ${index + 1}, hours after the deadline`}
                type="number"
                min={1}
                className="w-24"
                value={rule.atHoursAfter}
                onChange={(event) =>
                  onChange(
                    updateEscalationRule(stepWithSla, index, {
                      ...rule,
                      atHoursAfter: Number(event.target.value),
                    }),
                  )
                }
              />
              <span className="text-sm text-muted-foreground">hours after the deadline</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Move level ${index + 1} up`}
                disabled={index === 0}
                onClick={() => onChange(moveEscalationRule(stepWithSla, index, -1))}
              >
                <ChevronUp aria-hidden="true" className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Move level ${index + 1} down`}
                disabled={index === escalation.length - 1}
                onClick={() => onChange(moveEscalationRule(stepWithSla, index, 1))}
              >
                <ChevronDown aria-hidden="true" className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove level ${index + 1}`}
                onClick={() => onChange(removeEscalationRule(stepWithSla, index))}
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange(addEscalationRule(stepWithSla, { strategy: 'lineManager', atHoursAfter: 24 }))
          }
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Add escalation level
        </Button>
      </div>
    </div>
  );
}

export function StepPanel({
  step,
  otherStepKeys,
  personFields,
  formFields,
  onChange,
  onDelete,
  onSetAsStart,
  isStart,
}: StepPanelProps) {
  const idPrefix = useId();

  function toggleDecision(decision: WorkflowDecisionAction, enabled: boolean) {
    const allowedDecisions = enabled
      ? [...step.allowedDecisions, decision]
      : step.allowedDecisions.filter((d) => d !== decision);
    const requireCommentOn = step.requireCommentOn?.filter((d) => allowedDecisions.includes(d));
    onChange({ ...step, allowedDecisions, ...(requireCommentOn ? { requireCommentOn } : {}) });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {STEP_TYPE_LABELS[step.type]}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onDelete}>
          <Trash2 aria-hidden="true" className="h-4 w-4" />
          Remove
        </Button>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="startStep"
          className="h-4 w-4 accent-primary"
          checked={isStart}
          onChange={onSetAsStart}
        />
        This is the first step
      </label>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-name`}>Step name</Label>
        <Input
          id={`${idPrefix}-name`}
          value={step.name}
          onChange={(event) => onChange({ ...step, name: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-type`}>Step type</Label>
        <Select
          id={`${idPrefix}-type`}
          value={step.type}
          onChange={(event) => {
            const type = event.target.value as StepType;
            onChange({ ...step, type, allowedDecisions: DEFAULT_DECISIONS_BY_TYPE[type] });
          }}
        >
          {(Object.keys(STEP_TYPE_LABELS) as StepType[]).map((type) => (
            <option key={type} value={type}>
              {STEP_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-instructions`}>Instructions (optional)</Label>
        <Textarea
          id={`${idPrefix}-instructions`}
          value={step.instructions ?? ''}
          onChange={(event) => {
            const instructions = event.target.value;
            const { instructions: _drop, ...rest } = step;
            onChange(instructions ? { ...rest, instructions } : rest);
          }}
        />
      </div>

      <AssignmentEditor
        assignment={step.assignment}
        personFields={personFields}
        onChange={(assignment) => onChange({ ...step, assignment })}
      />

      <div className="flex flex-col gap-2 border-t border-divider pt-4">
        <Label>Decisions this step allows</Label>
        {(Object.keys(DECISION_LABELS) as WorkflowDecisionAction[]).map((decision) => (
          <div key={decision} className="flex flex-col gap-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={step.allowedDecisions.includes(decision)}
                onChange={(event) => toggleDecision(decision, event.target.checked)}
              />
              {DECISION_LABELS[decision]}
            </label>
            {step.allowedDecisions.includes(decision) ? (
              <label className="ms-6 flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-primary"
                  checked={step.requireCommentOn?.includes(decision) === true}
                  onChange={(event) => {
                    const current = step.requireCommentOn ?? [];
                    const requireCommentOn = event.target.checked
                      ? [...current, decision]
                      : current.filter((d) => d !== decision);
                    onChange(
                      requireCommentOn.length > 0
                        ? { ...step, requireCommentOn }
                        : (() => {
                            const { requireCommentOn: _drop, ...rest } = step;
                            return rest;
                          })(),
                    );
                  }}
                />
                Require a comment
              </label>
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-divider pt-4">
        <Label htmlFor={`${idPrefix}-sla`}>SLA, in hours (optional)</Label>
        <Input
          id={`${idPrefix}-sla`}
          type="number"
          min={1}
          value={step.sla?.durationHours ?? ''}
          onChange={(event) => {
            const durationHours = event.target.value ? Number(event.target.value) : undefined;
            if (durationHours === undefined) {
              const { sla: _drop, ...rest } = step;
              onChange(rest);
              return;
            }
            onChange({ ...step, sla: { ...step.sla, durationHours } });
          }}
        />
      </div>

      {step.sla ? (
        <SlaTimersEditor
          step={step}
          sla={step.sla}
          personFields={personFields}
          onChange={onChange}
        />
      ) : null}

      <div className="flex flex-col gap-3 border-t border-divider pt-4">
        {step.allowedDecisions.map((decision) => (
          <DecisionTransitions
            key={decision}
            step={step}
            decision={decision}
            otherStepKeys={otherStepKeys}
            formFields={formFields}
            onChange={onChange}
          />
        ))}
      </div>
    </div>
  );
}
