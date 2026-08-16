import { AlertTriangle, CircleAlert, CircleCheck } from 'lucide-react';

import type { ValidationIssue } from './validation';

export interface ValidationPanelProps {
  issues: ValidationIssue[];
}

// PRD.md §13.2: a validation panel for publish-blocking errors. Warnings
// are listed too (empty section, orphaned title field), since they are
// worth a process owner's attention even though publish does not wait on
// them.
export function ValidationPanel({ issues }: ValidationPanelProps) {
  if (issues.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-success-subtle-foreground">
        <CircleCheck aria-hidden="true" className="h-4 w-4" />
        No problems found.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {issues.map((issue, index) => (
        <li
          key={index}
          className={
            issue.severity === 'error'
              ? 'flex items-start gap-2 text-sm text-destructive-subtle-foreground'
              : 'flex items-start gap-2 text-sm text-warning-subtle-foreground'
          }
        >
          {issue.severity === 'error' ? (
            <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          {issue.message}
        </li>
      ))}
    </ul>
  );
}
