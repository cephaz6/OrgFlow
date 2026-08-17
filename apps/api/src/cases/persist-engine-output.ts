import {
  appendAuditEvent,
  appendCaseTransition,
  cancelOpenTasksForCase,
  cancelTimersForCase,
  cancelTimersForTask,
  createCaseTask,
  createSlaTimer,
  markTaskEscalated,
  updateCaseState,
} from '@orgflow/db';
import type { Database } from '@orgflow/db';
import type { AuditActorType, Case, CaseTask, DomainEvent, EngineOutput } from '@orgflow/types';
import type { Transaction } from 'kysely';

export interface PersistEngineOutputInput {
  organisationId: string;
  // Null for a system-triggered advance (the SLA sweep resolving an
  // escalation): nobody acted, so there is nobody to name on the audit
  // trail or the transition record, both of which already accept null for
  // exactly this reason.
  actorUserId: string | null;
  // Defaults to 'user'. Set to 'scheduler' by the sweep so the audit event
  // records what actually triggered it, not merely who is left blank.
  actorType?: AuditActorType;
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
  // A cancellation reason. PRD.md §10 puts it on the case.cancelled
  // payload, but the engine's terminal handling has no reason to pass it
  // through: EngineEvent carries it, and nothing in the state machine acts
  // on it. So the caller supplies it here, alongside the reference and task
  // ids it already fills in for the same class of reason.
  reason?: string;
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
  const { output, existingCase, organisationId, actorUserId, actorType } = input;
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
  // not task rows), so the caller cancels every open one for the case. Its
  // still-scheduled timers go the same way (PRD.md §15.2: "all timers for a
  // task are cancelled when the task is completed, reassigned or
  // cancelled"), including ones on a task nobody ever decided.
  if (isTerminal) {
    await cancelOpenTasksForCase(trx, existingCase.caseId);
    await cancelTimersForCase(trx, existingCase.caseId);
  }

  for (const taskId of output.timersToCancel) {
    await cancelTimersForTask(trx, taskId);
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
        ...(spec.escalationLevel !== undefined ? { escalationLevel: spec.escalationLevel } : {}),
      }),
    );
  }

  const taskIdByStepKey = new Map(tasks.map((task) => [task.stepKey, task.taskId]));

  // timersToSchedule is only ever populated by enterStep (packages/core/src
  // /engine/advance.ts), which creates at most one task per advance() call,
  // so every timer in this batch belongs to that one task: the engine
  // cannot attach a task id itself, since the task's real id does not exist
  // until createCaseTask above assigns it.
  const scheduledTaskId = tasks[0]?.taskId ?? null;
  for (const timer of output.timersToSchedule) {
    await createSlaTimer(trx, {
      organisationId,
      caseId: existingCase.caseId,
      taskId: scheduledTaskId,
      timerType: timer.timerType,
      escalationLevel: timer.escalationLevel,
      fireAt: timer.fireAt,
    });
  }

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

    // The engine names the level it escalated to on the transition
    // (escalationTriggered in packages/core/src/engine/advance.ts) but
    // cannot stamp it onto the original task itself, since a pure engine
    // never writes to the database. Recording it here is what stops a
    // later-firing timer for the same task (a further escalation level,
    // scheduled independently at task creation) from re-walking the rule
    // list from level 1 and creating a duplicate task at the level this
    // one already resolved.
    const escalatedLevel = transition.conditionResult?.escalationLevel;
    if (
      transition.triggerType === 'escalation' &&
      transition.taskId &&
      typeof escalatedLevel === 'number'
    ) {
      await markTaskEscalated(trx, transition.taskId, escalatedLevel);
    }
  }

  await appendAuditEvent(trx, {
    organisationId,
    actorUserId,
    ...(actorType ? { actorType } : {}),
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
      ...(input.reason ? { reason: input.reason } : {}),
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
    events: enrichEvents(
      output.eventsToEmit,
      updatedCase,
      taskIdByStepKey,
      actorUserId,
      actorType,
      input.reason,
    ),
  };
}

// The engine cannot know three things, all of them assigned outside its
// reach, so they are filled in here rather than published incomplete.
//
// The task id and the case reference come from the database, inside the
// transaction the engine has no access to, and PRD.md §10 requires both in
// the payloads.
//
// The actor is subtler. EngineEvent carries no acting user, so `advance`
// falls back to `context.submitter.userId` when stamping an event. That is
// right for a submission, where the requester is the actor, and wrong for
// every decision after it: the context's submitter must stay the case's
// requester, or `lineManager` would resolve the approver's manager and
// `submitter` would return the case to the wrong person. The caller is the
// only party that knows who actually acted, so it stamps that here. The
// audit row written above already records the same actor.
function enrichEvents(
  events: DomainEvent[],
  updatedCase: Case,
  taskIdByStepKey: Map<string, string>,
  actorUserId: string | null,
  actorType: AuditActorType | undefined,
  reason: string | undefined,
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

    // PRD.md §10 gives case.cancelled a `reason`. Applied only to that type
    // rather than to every event in the advance, so a reason cannot leak
    // onto an unrelated event that happens to be emitted alongside it.
    if (event.eventType === 'case.cancelled' && reason) {
      payload.reason = reason;
    }

    return { ...event, actorUserId, ...(actorType ? { actorType } : {}), payload };
  });
}
