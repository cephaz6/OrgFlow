import type { ProcessDefinitionDocument } from '@orgflow/types';

import { computeLayout } from './layout';
import { isTerminalKey } from './step-defaults';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
  stepKey?: string;
}

const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;

// PRD.md §13.2: the workflow builder's live validation highlights
// unreachable steps, missing defaults and orphaned branches on the canvas.
// This computes the same findings the canvas colours red or amber; the
// validate tab lists them as text so the same information is available
// without ever looking at the canvas.
export function validateWorkflow(
  document: Pick<ProcessDefinitionDocument, 'workflow'>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { startStepKey, steps } = document.workflow;

  if (steps.length === 0) {
    if (!isTerminalKey(startStepKey)) {
      issues.push({
        severity: 'error',
        message: 'The start step must point at a real step or a terminal outcome.',
      });
    }
    return issues;
  }

  if (!steps.some((step) => step.key === startStepKey) && !isTerminalKey(startStepKey)) {
    issues.push({
      severity: 'error',
      message: `The start step "${startStepKey}" does not exist.`,
    });
  }

  const seenKeys = new Set<string>();
  for (const step of steps) {
    if (!KEY_PATTERN.test(step.key)) {
      issues.push({
        severity: 'error',
        message: `"${step.name}" has an invalid key.`,
        stepKey: step.key,
      });
    }
    if (seenKeys.has(step.key)) {
      issues.push({
        severity: 'error',
        message: `Two steps share the key "${step.key}".`,
        stepKey: step.key,
      });
    }
    seenKeys.add(step.key);

    for (const decision of step.allowedDecisions) {
      const rules = step.transitions[decision] ?? [];
      if (rules.length === 0) {
        issues.push({
          severity: 'error',
          message: `"${step.name}" allows "${decision}" but has no transition for it.`,
          stepKey: step.key,
        });
        continue;
      }

      const last = rules[rules.length - 1]!;
      if (last.when !== null) {
        issues.push({
          severity: 'warning',
          message: `"${step.name}"'s "${decision}" transitions have no default: a request could get stuck if none of the conditions match.`,
          stepKey: step.key,
        });
      }

      rules.forEach((rule, index) => {
        const targetExists =
          steps.some((candidate) => candidate.key === rule.to) || isTerminalKey(rule.to);
        if (!targetExists) {
          issues.push({
            severity: 'error',
            message: `"${step.name}"'s "${decision}" rule ${index + 1} points at "${rule.to}", which does not exist.`,
            stepKey: step.key,
          });
        }
      });
    }
  }

  const { nodes } = computeLayout(steps, startStepKey);
  for (const node of nodes) {
    if (!node.isTerminal && !node.reachable) {
      const step = steps.find((candidate) => candidate.key === node.key);
      issues.push({
        severity: 'warning',
        message: `"${step?.name ?? node.key}" cannot be reached from the start step.`,
        stepKey: node.key,
      });
    }
  }

  return issues;
}

export function hasBlockingIssues(issues: ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}
