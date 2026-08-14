import type { CaseTransition, TransitionTriggerType } from '@orgflow/types';
import type { Selectable, Transaction } from 'kysely';

import type { CaseTransitionsTable, Database } from '../schema.js';
import { generateId } from '../uuid.js';

function toDomain(row: Selectable<CaseTransitionsTable>): CaseTransition {
  return {
    transitionId: row.transition_id,
    organisationId: row.organisation_id,
    caseId: row.case_id,
    fromStepKey: row.from_step_key,
    toStepKey: row.to_step_key,
    triggerType: row.trigger_type as TransitionTriggerType,
    triggeredByUserId: row.triggered_by_user_id,
    taskId: row.task_id,
    conditionResult: row.condition_result,
    occurredAt: row.occurred_at.toISOString(),
  };
}

export interface AppendCaseTransitionInput {
  organisationId: string;
  caseId: string;
  fromStepKey: string | null;
  toStepKey: string | null;
  triggerType: TransitionTriggerType;
  triggeredByUserId?: string | null;
  taskId?: string | null;
  conditionResult?: Record<string, unknown> | null;
}

// Append-only like audit_events, and for the same reason: PRD.md §6.4 says
// every state change produces a transition record and there are no silent
// transitions, so a rewritable history would make the case timeline
// unreliable. orgflow_app holds only INSERT and SELECT on this table
// (see the process-and-case-tables migration); there is deliberately no
// update or delete function here.
export async function appendCaseTransition(
  trx: Transaction<Database>,
  input: AppendCaseTransitionInput,
): Promise<CaseTransition> {
  const row = await trx
    .insertInto('case_transitions')
    .values({
      transition_id: generateId(),
      organisation_id: input.organisationId,
      case_id: input.caseId,
      from_step_key: input.fromStepKey,
      to_step_key: input.toStepKey,
      trigger_type: input.triggerType,
      triggered_by_user_id: input.triggeredByUserId ?? null,
      task_id: input.taskId ?? null,
      condition_result: input.conditionResult ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toDomain(row);
}

export async function findCaseTransitionsForCase(
  trx: Transaction<Database>,
  caseId: string,
): Promise<CaseTransition[]> {
  const rows = await trx
    .selectFrom('case_transitions')
    .selectAll()
    .where('case_id', '=', caseId)
    .orderBy('occurred_at', 'asc')
    .execute();

  return rows.map(toDomain);
}
