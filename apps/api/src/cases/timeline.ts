import {
  findAuditEventsForCase,
  findCaseTasksForCase,
  findCaseTransitionsForCase,
} from '@orgflow/db';
import type { Database } from '@orgflow/db';
import type { Transaction } from 'kysely';

export type TimelineEntry =
  | {
      kind: 'transition';
      occurredAt: string;
      fromStepKey: string | null;
      toStepKey: string | null;
      triggerType: string;
      triggeredByUserId: string | null;
      conditionResult: Record<string, unknown> | null;
    }
  | {
      kind: 'decision';
      occurredAt: string;
      taskId: string;
      stepKey: string;
      stepName: string;
      decision: string;
      comment: string | null;
      actorUserId: string | null;
    }
  | {
      kind: 'audit';
      occurredAt: string;
      action: string;
      actorUserId: string | null;
      payload: Record<string, unknown>;
    };

// PRD.md §11.5: transitions, decisions, comments and audit, merged.
// Comments are absent because nothing writes one yet: POST
// /cases/:id/comments is not part of this step, and reading a table with no
// writer would be speculative. The merge is by occurredAt, so comments slot
// in without changing this shape when that endpoint lands.
export async function buildCaseTimeline(
  trx: Transaction<Database>,
  caseId: string,
): Promise<TimelineEntry[]> {
  const [transitions, tasks, auditEvents] = await Promise.all([
    findCaseTransitionsForCase(trx, caseId),
    findCaseTasksForCase(trx, caseId),
    findAuditEventsForCase(trx, caseId),
  ]);

  const entries: TimelineEntry[] = [
    ...transitions.map((transition): TimelineEntry => ({
      kind: 'transition',
      occurredAt: transition.occurredAt,
      fromStepKey: transition.fromStepKey,
      toStepKey: transition.toStepKey,
      triggerType: transition.triggerType,
      triggeredByUserId: transition.triggeredByUserId,
      conditionResult: transition.conditionResult,
    })),
    ...tasks
      .filter((task) => task.decision !== null && task.completedAt !== null)
      .map((task): TimelineEntry => ({
        kind: 'decision',
        occurredAt: task.completedAt!,
        taskId: task.taskId,
        stepKey: task.stepKey,
        stepName: task.stepName,
        decision: task.decision!,
        comment: task.comment,
        actorUserId: task.completedByUserId,
      })),
    ...auditEvents.map((audit): TimelineEntry => ({
      kind: 'audit',
      occurredAt: audit.occurredAt,
      action: audit.action,
      actorUserId: audit.actorUserId,
      payload: audit.payload,
    })),
  ];

  return entries.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
}
