import {
  appendAuditEvent,
  appendCaseTransition,
  cancelOpenTasksForCase,
  createCaseTask,
  updateCaseState,
} from '@orgflow/db';
import type { Database } from '@orgflow/db';
import type { Case, CaseTask, DomainEvent, EngineOutput } from '@orgflow/types';
import type { Transaction } from 'kysely';

export interface PersistEngineOutputInput {
  organisationId: string;
  actorUserId: string;
  correlationId: string;
  existingCase: Case;
  output: EngineOutput;
  // Set only by the submit path, which allocates the reference and pins the
  // version in the same transaction (ADR-0013, PRD.md §8.2).
  reference?: string;
  versionId?: string;
  title?: string;
  valuesDocumentId?: string | null;
  submittedAt?: Date;
  auditAction: string;
}

export interface PersistedEngineOutput {
  updatedCase: Case;
  tasks: CaseTask[];
  // The engine's events, with the identifiers only the database knows
  // filled in. Published after the transaction commits, never inside it.
  events: DomainEvent[];
}

// The engine returns what should happen; this applies all of it in one
// transaction (PRD.md §6.1). Case row, tasks, transitions and audit either
// all land or none do, which is what makes an audit gap impossible rather
// than merely unlikely.
export async function persistEngineOutput(
  trx: Transaction<Database>,
  input: PersistEngineOutputInput,
): Promise<PersistedEngineOutput> {
  const { output, existingCase, organisationId, actorUserId } = input;
  const now = new Date();

  const terminalStatuses = ['completed', 'rejected', 'cancelled'];
  const nextStatus = output.caseUpdates.status ?? existingCase.status;
  const isTerminal = terminalStatuses.includes(nextStatus);

  const updatedCase = await updateCaseState(trx, {
    caseId: existingCase.caseId,
    expectedRowVersion: existingCase.rowVersion,
    ...(output.caseUpdates.status !== undefined ? { status: output.caseUpdates.status } : {}),
    ...(output.caseUpdates.outcome !== undefined ? { outcome: output.caseUpdates.outcome } : {}),
    ...(output.caseUpdates.currentStepKey !== undefined
      ? { currentStepKey: output.caseUpdates.currentStepKey }
      : {}),
    ...(input.reference !== undefined ? { reference: input.reference } : {}),
    ...(input.versionId !== undefined ? { versionId: input.versionId } : {}),
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.valuesDocumentId !== undefined ? { valuesDocumentId: input.valuesDocumentId } : {}),
    ...(input.submittedAt !== undefined ? { submittedAt: input.submittedAt } : {}),
    ...(isTerminal ? { completedAt: now } : {}),
  });

  // PRD.md §6.3 step 4 cancels outstanding work on reaching a terminal
  // step. The engine cannot name the tasks (EngineInput carries case state,
  // not task rows), so the caller cancels every open one for the case.
  if (isTerminal) {
    await cancelOpenTasksForCase(trx, existingCase.caseId);
  }

  const tasks: CaseTask[] = [];
  for (const spec of output.tasksToCreate) {
    tasks.push(
      await createCaseTask(trx, {
        organisationId,
        caseId: existingCase.caseId,
        stepKey: spec.stepKey,
        stepName: spec.stepName,
        taskType: spec.taskType,
        assignmentStrategy: spec.assignmentStrategy,
        assigneeUserId: spec.assigneeUserId,
        assigneeGroupId: spec.assigneeGroupId,
        assigneeRole: spec.assigneeRole,
        delegatedFromUserId: spec.delegatedFromUserId,
        dueAt: spec.dueAt ? new Date(spec.dueAt) : null,
      }),
    );
  }

  const taskIdByStepKey = new Map(tasks.map((task) => [task.stepKey, task.taskId]));

  for (const transition of output.transitions) {
    await appendCaseTransition(trx, {
      organisationId,
      caseId: existingCase.caseId,
      fromStepKey: transition.fromStepKey,
      toStepKey: transition.toStepKey,
      triggerType: transition.triggerType,
      triggeredByUserId: actorUserId,
      // The engine names the step; the task id for that step only exists
      // once the row above is written.
      taskId:
        transition.taskId ??
        (transition.toStepKey ? (taskIdByStepKey.get(transition.toStepKey) ?? null) : null),
      conditionResult: transition.conditionResult ?? null,
    });
  }

  await appendAuditEvent(trx, {
    organisationId,
    actorUserId,
    entityType: 'case',
    entityId: existingCase.caseId,
    action: input.auditAction,
    payload: {
      reference: updatedCase.reference,
      status: updatedCase.status,
      currentStepKey: updatedCase.currentStepKey,
      versionId: updatedCase.versionId,
      transitions: output.transitions.map((transition) => ({
        fromStepKey: transition.fromStepKey,
        toStepKey: transition.toStepKey,
        triggerType: transition.triggerType,
      })),
      tasksCreated: tasks.map((task) => task.taskId),
      // Engine errors are part of the audit record, not a side channel: a
      // case sitting in `unassigned` needs the reason on the trail an
      // administrator reads.
      ...(output.errors.length > 0 ? { engineErrors: output.errors } : {}),
    },
    correlationId: input.correlationId,
  });

  return {
    updatedCase,
    tasks,
    events: enrichEvents(output.eventsToEmit, updatedCase, taskIdByStepKey),
  };
}

// The engine cannot know a task id or a case reference: both are assigned
// by the database inside the transaction it has no access to. PRD.md §10
// requires them in the payloads, so they are filled in here rather than
// published incomplete.
function enrichEvents(
  events: DomainEvent[],
  updatedCase: Case,
  taskIdByStepKey: Map<string, string>,
): DomainEvent[] {
  return events.map((event) => {
    const payload: Record<string, unknown> = { ...event.payload, reference: updatedCase.reference };

    if (event.eventType === 'task.created') {
      const stepKey = typeof event.payload.stepKey === 'string' ? event.payload.stepKey : null;
      const taskId = stepKey ? taskIdByStepKey.get(stepKey) : undefined;
      if (taskId) {
        payload.taskId = taskId;
      }
    }

    return { ...event, payload };
  });
}
