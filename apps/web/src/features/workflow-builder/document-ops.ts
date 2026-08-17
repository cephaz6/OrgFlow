import type { TransitionRule, WorkflowDecisionAction, WorkflowStep } from '@orgflow/types';

// Pure operations on a document's workflow.steps, mirroring
// features/form-builder/document-ops.ts: the canvas and the list view both
// call these and replace the document with the result, so neither can
// drift from what the other produces. Step order in the array has no
// execution meaning (the engine routes by key, from startStepKey), but a
// stable order is still what the list view iterates, so moveStep exists for
// that alone.

export function addStep(steps: WorkflowStep[], step: WorkflowStep): WorkflowStep[] {
  return [...steps, step];
}

export function removeStep(steps: WorkflowStep[], stepKey: string): WorkflowStep[] {
  return steps.filter((step) => step.key !== stepKey);
}

export function updateStep(
  steps: WorkflowStep[],
  stepKey: string,
  next: WorkflowStep,
): WorkflowStep[] {
  return steps.map((step) => (step.key === stepKey ? next : step));
}

export function moveStep(
  steps: WorkflowStep[],
  stepKey: string,
  direction: -1 | 1,
): WorkflowStep[] {
  const index = steps.findIndex((step) => step.key === stepKey);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= steps.length) {
    return steps;
  }
  const next = [...steps];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

// PRD.md §5.4 evaluates a decision's rules first-match-wins, so where a new
// rule lands matters, not just that it lands. A new default (`when: null`)
// always belongs last, since nothing after a default could ever be
// reached. A new conditional rule belongs before any existing trailing
// default, for the same reason: appended after it, the default would
// always win first and the new condition would never be evaluated.
export function addTransitionRule(
  step: WorkflowStep,
  decision: WorkflowDecisionAction,
  rule: TransitionRule,
): WorkflowStep {
  const existing = step.transitions[decision] ?? [];
  const trailingDefault = existing.length > 0 && existing[existing.length - 1]!.when === null;

  const next =
    rule.when === null || !trailingDefault
      ? [...existing, rule]
      : [...existing.slice(0, -1), rule, existing[existing.length - 1]!];

  return { ...step, transitions: { ...step.transitions, [decision]: next } };
}

export function removeTransitionRule(
  step: WorkflowStep,
  decision: WorkflowDecisionAction,
  index: number,
): WorkflowStep {
  const existing = step.transitions[decision] ?? [];
  return {
    ...step,
    transitions: { ...step.transitions, [decision]: existing.filter((_rule, i) => i !== index) },
  };
}

export function updateTransitionRule(
  step: WorkflowStep,
  decision: WorkflowDecisionAction,
  index: number,
  rule: TransitionRule,
): WorkflowStep {
  const existing = step.transitions[decision] ?? [];
  return {
    ...step,
    transitions: {
      ...step.transitions,
      [decision]: existing.map((entry, i) => (i === index ? rule : entry)),
    },
  };
}

// Moves a rule one place towards the start or end of its decision's list.
// Order is meaning here, unlike moveStep: first-match-wins makes this the
// one reorder in the whole builder that changes what the workflow does.
export function moveTransitionRule(
  step: WorkflowStep,
  decision: WorkflowDecisionAction,
  index: number,
  direction: -1 | 1,
): WorkflowStep {
  const existing = step.transitions[decision] ?? [];
  const target = index + direction;
  if (target < 0 || target >= existing.length) {
    return step;
  }
  const next = [...existing];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return { ...step, transitions: { ...step.transitions, [decision]: next } };
}

const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;

// Mirrors features/form-builder/document-ops.ts's keyFrom: a stable,
// server-valid key derived from a label, unique among a step's siblings.
export function stepKeyFrom(label: string, existing: readonly string[]): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '');
  const root = KEY_PATTERN.test(base) ? base : `step_${Math.random().toString(36).slice(2, 7)}`;
  if (!existing.includes(root)) {
    return root;
  }
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${root}_${suffix}`;
    if (!existing.includes(candidate)) {
      return candidate;
    }
  }
  return `${root}_${Date.now()}`;
}
