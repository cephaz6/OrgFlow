import type { SlaTimer, SlaTimerStatus, TimerType } from '@orgflow/types';
import type { Kysely, Selectable, Transaction } from 'kysely';

import type { Database, SlaTimersTable } from '../schema.js';
import { generateId } from '../uuid.js';

function toDomain(row: Selectable<SlaTimersTable>): SlaTimer {
  return {
    timerId: row.timer_id,
    organisationId: row.organisation_id,
    caseId: row.case_id,
    taskId: row.task_id,
    scheduleName: row.schedule_name,
    timerType: row.timer_type as TimerType,
    escalationLevel: row.escalation_level,
    fireAt: row.fire_at.toISOString(),
    status: row.status as SlaTimerStatus,
    firedAt: row.fired_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export interface CreateSlaTimerInput {
  organisationId: string;
  caseId: string;
  taskId: string | null;
  timerType: TimerType;
  escalationLevel: number;
  fireAt: string;
}

// scheduleName is not taken as an input: nothing local has a real
// EventBridge Scheduler schedule to name, so the timer's own id (generated
// here, not by the caller) stands in for it. schedule_name is NOT NULL
// precisely because PRD.md §2.4 expects a real one there once that
// implementation exists, and a nullable placeholder column would still need
// tightening at that point; generating a stand-in now means the column
// never needs to change.
export async function createSlaTimer(
  trx: Transaction<Database>,
  input: CreateSlaTimerInput,
): Promise<SlaTimer> {
  const timerId = generateId();
  const row = await trx
    .insertInto('sla_timers')
    .values({
      timer_id: timerId,
      organisation_id: input.organisationId,
      case_id: input.caseId,
      task_id: input.taskId,
      schedule_name: `local:${timerId}`,
      timer_type: input.timerType,
      escalation_level: input.escalationLevel,
      fire_at: new Date(input.fireAt),
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toDomain(row);
}

// The one query in this repository that is not scoped to a single tenant's
// transaction: a sweep has to find due work across every organisation, not
// one tenant's slice of it, and that is a database fact this function
// exists specifically to make explicit rather than something a caller could
// forget inside withTenantTransaction. It takes the plain, unscoped
// connection (never a Transaction<Database>, which under this codebase's
// convention always means "already SET LOCAL ROLE orgflow_app and scoped to
// one organisation"). Every row returned still carries its own
// organisation_id, and every mutation that follows from processing one
// happens inside withTenantTransaction(db, thatRow.organisationId, ...),
// never on this connection.
export async function findDueTimers(db: Kysely<Database>, now: Date): Promise<SlaTimer[]> {
  const rows = await db
    .selectFrom('sla_timers')
    .selectAll()
    .where('status', '=', 'scheduled')
    .where('fire_at', '<=', now)
    .orderBy('fire_at', 'asc')
    .execute();

  return rows.map(toDomain);
}

export async function markTimerFired(trx: Transaction<Database>, timerId: string): Promise<void> {
  await trx
    .updateTable('sla_timers')
    .set({ status: 'fired', fired_at: new Date() })
    .where('timer_id', '=', timerId)
    .where('status', '=', 'scheduled')
    .execute();
}

// PRD.md §15.2: "all timers for a task are cancelled when the task is
// completed, reassigned or cancelled." Matches the engine's own
// timersToCancel: Uuid[], which names the task, not a specific timer.
export async function cancelTimersForTask(
  trx: Transaction<Database>,
  taskId: string,
): Promise<void> {
  await trx
    .updateTable('sla_timers')
    .set({ status: 'cancelled' })
    .where('task_id', '=', taskId)
    .where('status', '=', 'scheduled')
    .execute();
}

// A case reaching a terminal status cancels every timer still open for it,
// including ones on tasks that were never individually decided (e.g. a
// case cancelled outright while a task sat untouched).
export async function cancelTimersForCase(
  trx: Transaction<Database>,
  caseId: string,
): Promise<void> {
  await trx
    .updateTable('sla_timers')
    .set({ status: 'cancelled' })
    .where('case_id', '=', caseId)
    .where('status', '=', 'scheduled')
    .execute();
}
