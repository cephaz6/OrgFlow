'use client';

import type { EngineError, TaskSpec, TransitionRecord } from '@orgflow/types';
import { StatusBadge } from '@orgflow/ui';
import {
  AlertTriangle,
  ArrowRight,
  CircleCheck,
  CircleDot,
  CircleX,
  Clock,
  Send,
  UserRound,
} from 'lucide-react';

import type { SimulationEntry } from './simulate';

export interface TraceViewProps {
  entries: SimulationEntry[];
  // Reversed to turn the synthetic ids in a TaskSpec back into the group key
  // the workflow actually named, since an id means nothing to a reader.
  groupKeysById: Record<string, string>;
  stepNamesByKey: Record<string, string>;
}

function formatMoment(iso: string): string {
  // en-GB explicitly rather than the visitor's locale: a simulated deadline
  // is being compared against a definition written in one place, and a date
  // that silently reorders its day and month between readers is a
  // correctness trap in exactly the feature meant to make timing legible.
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function describeAssignee(task: TaskSpec, groupKeysById: Record<string, string>): string {
  if (task.assigneeGroupId) {
    const key = groupKeysById[task.assigneeGroupId];
    return key ? `the ${key} group` : 'a group';
  }
  if (task.assigneeRole) {
    return `anyone with the ${task.assigneeRole} role`;
  }
  switch (task.assignmentStrategy) {
    case 'lineManager':
      return "the requester's line manager";
    case 'lineManagerOfAssignee':
      return "the previous assignee's line manager";
    case 'submitter':
      return 'the requester';
    case 'fieldReference':
      return 'the person the requester named';
    default:
      return 'the resolved assignee';
  }
}

interface EvaluatedRule {
  to: string;
  matched: boolean;
  warnings: string[];
}

function evaluatedRules(transition: TransitionRecord): EvaluatedRule[] | null {
  const evaluated = transition.conditionResult?.evaluated;
  if (!Array.isArray(evaluated)) {
    return null;
  }
  return evaluated as EvaluatedRule[];
}

function stepLabel(key: string | null, stepNamesByKey: Record<string, string>): string {
  if (!key) return 'the request';
  const terminal: Record<string, string> = {
    $completed: 'Completed',
    $rejected: 'Rejected',
    $cancelled: 'Cancelled',
    $returnedToRequester: 'Returned to the requester',
  };
  return terminal[key] ?? stepNamesByKey[key] ?? key;
}

function TaskCard({
  task,
  groupKeysById,
}: {
  task: TaskSpec;
  groupKeysById: Record<string, string>;
}) {
  return (
    <div className="rounded-md border border-divider bg-muted/40 p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <UserRound aria-hidden="true" className="h-4 w-4" />
        {task.stepName} goes to {describeAssignee(task, groupKeysById)}
      </p>
      {task.delegatedFromUserId ? (
        <p className="mt-1 text-xs text-muted-foreground">Redirected by an active delegation.</p>
      ) : null}
      {task.dueAt ? (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock aria-hidden="true" className="h-3.5 w-3.5" />
          Due {formatMoment(task.dueAt)}
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">No deadline on this step.</p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">Can {task.allowedDecisions.join(', ')}.</p>
    </div>
  );
}

function BranchExplanation({
  transition,
  stepNamesByKey,
}: {
  transition: TransitionRecord;
  stepNamesByKey: Record<string, string>;
}) {
  const rules = evaluatedRules(transition);
  if (!rules || rules.length === 0) {
    return null;
  }

  return (
    <ol className="mt-2 flex flex-col gap-1">
      {rules.map((rule, index) => (
        <li key={index} className="flex items-start gap-2 text-xs">
          <span aria-hidden="true" className="text-muted-foreground">
            {rule.matched ? '✓' : '·'}
          </span>
          <span className={rule.matched ? 'font-medium' : 'text-muted-foreground'}>
            Rule {index + 1} to {stepLabel(rule.to, stepNamesByKey)}:{' '}
            {rule.matched ? 'matched, and was taken' : 'did not match'}
            {rule.warnings.length > 0 ? ` (${rule.warnings.join('; ')})` : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ErrorRow({ error }: { error: EngineError }) {
  // Every engine error is shown, including the ones that are not failures:
  // selfApprovalGuard means the guard worked, which the message says.
  return (
    <li className="flex items-start gap-2 text-xs">
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
      <span>
        <span className="font-medium">{error.code}</span>: {error.message}
      </span>
    </li>
  );
}

export function TraceView({ entries, groupKeysById, stepNamesByKey }: TraceViewProps) {
  return (
    <ol className="flex flex-col gap-3">
      {entries.map((entry, index) => {
        const heading =
          entry.event.type === 'caseSubmitted'
            ? 'Request submitted'
            : entry.event.type === 'taskDecided'
              ? `Decision: ${entry.event.decision}`
              : entry.event.type;

        return (
          <li key={index} className="rounded-lg border border-border p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              {entry.event.type === 'caseSubmitted' ? (
                <Send aria-hidden="true" className="h-4 w-4" />
              ) : (
                <CircleDot aria-hidden="true" className="h-4 w-4" />
              )}
              {heading}
            </p>

            {entry.output.transitions.map((transition, transitionIndex) => (
              <div key={transitionIndex} className="mt-2">
                <p className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">
                    {stepLabel(transition.fromStepKey, stepNamesByKey)}
                  </span>
                  <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span className="font-medium">
                    {stepLabel(transition.toStepKey, stepNamesByKey)}
                  </span>
                </p>
                <BranchExplanation transition={transition} stepNamesByKey={stepNamesByKey} />
              </div>
            ))}

            {entry.output.tasksToCreate.length > 0 ? (
              <div className="mt-3 flex flex-col gap-2">
                {entry.output.tasksToCreate.map((task, taskIndex) => (
                  <TaskCard key={taskIndex} task={task} groupKeysById={groupKeysById} />
                ))}
              </div>
            ) : null}

            {entry.output.timersToSchedule.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1">
                {entry.output.timersToSchedule.map((timer, timerIndex) => (
                  <li
                    key={timerIndex}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                    {timer.timerType === 'reminder'
                      ? 'Reminder'
                      : `Escalation to level ${timer.escalationLevel}`}{' '}
                    at {formatMoment(timer.fireAt)}
                  </li>
                ))}
              </ul>
            ) : null}

            {entry.output.errors.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1.5">
                {entry.output.errors.map((error, errorIndex) => (
                  <ErrorRow key={errorIndex} error={error} />
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function OutcomeBadge({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <StatusBadge tone="success" icon={CircleCheck} label="Completed: approved" />;
    case 'rejected':
      return <StatusBadge tone="danger" icon={CircleX} label="Rejected" />;
    case 'cancelled':
      return <StatusBadge tone="neutral" icon={CircleX} label="Cancelled" />;
    case 'unassigned':
      return <StatusBadge tone="warning" icon={AlertTriangle} label="Stalled: unassigned" />;
    default:
      return <StatusBadge tone="info" icon={CircleDot} label="In progress" />;
  }
}
