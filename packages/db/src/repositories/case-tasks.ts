import type { CaseTask, TaskDecision, TaskStatus, TaskType } from '@orgflow/types';
import { sql, type Selectable, type Transaction } from 'kysely';

import { clampPageSize, decodeCompositeCursor, encodeCompositeCursor } from '../pagination.js';
import type { CaseTasksTable, Database } from '../schema.js';
import { generateId } from '../uuid.js';

function toDomain(row: Selectable<CaseTasksTable>): CaseTask {
  return {
    taskId: row.task_id,
    organisationId: row.organisation_id,
    caseId: row.case_id,
    stepKey: row.step_key,
    stepName: row.step_name,
    taskType: row.task_type as TaskType,
    assignmentStrategy: row.assignment_strategy,
    assigneeUserId: row.assignee_user_id,
    assigneeGroupId: row.assignee_group_id,
    assigneeRole: row.assignee_role,
    delegatedFromUserId: row.delegated_from_user_id,
    status: row.status as TaskStatus,
    decision: row.decision as TaskDecision | null,
    comment: row.comment,
    dueAt: row.due_at?.toISOString() ?? null,
    escalationLevel: row.escalation_level,
    escalatedAt: row.escalated_at?.toISOString() ?? null,
    claimedByUserId: row.claimed_by_user_id,
    claimedAt: row.claimed_at?.toISOString() ?? null,
    completedByUserId: row.completed_by_user_id,
    completedAt: row.completed_at?.toISOString() ?? null,
    rowVersion: row.row_version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface CreateCaseTaskInput {
  organisationId: string;
  caseId: string;
  stepKey: string;
  stepName: string;
  taskType: TaskType;
  assignmentStrategy: string;
  assigneeUserId?: string | null;
  assigneeGroupId?: string | null;
  assigneeRole?: string | null;
  delegatedFromUserId?: string | null;
  dueAt?: Date | null;
  // Set only for the additional task an escalation creates (PRD.md §15.3);
  // absent leaves the column at its default of 0. escalated_at is stamped
  // here to now() whenever a level is given, rather than taken as a
  // separate input, since the two only ever change together.
  escalationLevel?: number;
}

export async function createCaseTask(
  trx: Transaction<Database>,
  input: CreateCaseTaskInput,
): Promise<CaseTask> {
  const row = await trx
    .insertInto('case_tasks')
    .values({
      task_id: generateId(),
      organisation_id: input.organisationId,
      case_id: input.caseId,
      step_key: input.stepKey,
      step_name: input.stepName,
      task_type: input.taskType,
      assignment_strategy: input.assignmentStrategy,
      assignee_user_id: input.assigneeUserId ?? null,
      assignee_group_id: input.assigneeGroupId ?? null,
      assignee_role: input.assigneeRole ?? null,
      delegated_from_user_id: input.delegatedFromUserId ?? null,
      due_at: input.dueAt ?? null,
      ...(input.escalationLevel !== undefined
        ? { escalation_level: input.escalationLevel, escalated_at: new Date() }
        : {}),
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toDomain(row);
}

// Stamped onto the task an escalation was triggered against, so a later
// timer for the same task (a further escalation level, still scheduled)
// resumes from where this one left off rather than re-walking the rule
// list from level 1 and creating a duplicate task at the same level.
export async function markTaskEscalated(
  trx: Transaction<Database>,
  taskId: string,
  escalationLevel: number,
): Promise<void> {
  await trx
    .updateTable('case_tasks')
    .set({ escalation_level: escalationLevel, escalated_at: new Date() })
    .where('task_id', '=', taskId)
    .where('escalation_level', '<', escalationLevel)
    .execute();
}

export async function findCaseTaskById(
  trx: Transaction<Database>,
  taskId: string,
): Promise<CaseTask | null> {
  const row = await trx
    .selectFrom('case_tasks')
    .selectAll()
    .where('task_id', '=', taskId)
    .executeTakeFirst();

  return row ? toDomain(row) : null;
}

export async function findCaseTasksForCase(
  trx: Transaction<Database>,
  caseId: string,
): Promise<CaseTask[]> {
  const rows = await trx
    .selectFrom('case_tasks')
    .selectAll()
    .where('case_id', '=', caseId)
    .orderBy('created_at', 'asc')
    .execute();

  return rows.map(toDomain);
}

// The approvals queue: tasks directly assigned to this user and still open.
export async function findOpenTasksForAssignee(
  trx: Transaction<Database>,
  assigneeUserId: string,
): Promise<CaseTask[]> {
  const rows = await trx
    .selectFrom('case_tasks')
    .selectAll()
    .where('assignee_user_id', '=', assigneeUserId)
    .where('status', 'in', ['pending', 'claimed'])
    .orderBy('due_at', 'asc')
    .execute();

  return rows.map(toDomain);
}

// A task plus the case columns any queue screen needs to render a row.
// Deliberately a query projection rather than a domain entity, so it lives
// here instead of in @orgflow/types: nothing owns a "task with a case
// reference stapled on" as a concept, and the alternative is the caller
// issuing a second query per task purely to print a heading.
export interface TaskQueueEntry {
  task: CaseTask;
  caseReference: string;
  caseTitle: string;
  definitionId: string;
  // PRD.md §13.2 puts the requester on every row of the approval queue, so
  // an approver can triage without opening each one.
  requesterUserId: string;
  requesterName: string;
}

const QUEUE_COLUMNS = [
  'cases.reference as case_reference',
  'cases.title as case_title',
  'cases.definition_id as case_definition_id',
  'cases.submitted_by_user_id as case_submitted_by_user_id',
  'requester.display_name as requester_display_name',
] as const;

interface QueueRow extends Selectable<CaseTasksTable> {
  case_reference: string;
  case_title: string;
  case_definition_id: string;
  case_submitted_by_user_id: string;
  requester_display_name: string;
}

function toQueueEntry(row: QueueRow): TaskQueueEntry {
  return {
    task: toDomain(row),
    caseReference: row.case_reference,
    caseTitle: row.case_title,
    definitionId: row.case_definition_id,
    requesterUserId: row.case_submitted_by_user_id,
    requesterName: row.requester_display_name,
  };
}

export interface TaskQueueFilter {
  status?: TaskStatus;
  definitionId?: string;
  // PRD.md §11.6 offers an `overdue` filter. Comparing against a caller-
  // supplied instant rather than now() keeps the query as deterministic as
  // the rest of the stack, and lets a test pin the clock.
  overdueAt?: Date;
  // Free text over the case's reference or title. Absent means no filter
  // rather than an empty search, which would otherwise match nothing.
  query?: string;
  limit?: number;
  cursor?: string;
}

export interface TaskQueuePage {
  entries: TaskQueueEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface QueueCursor extends Record<string, string> {
  // An ISO timestamp, or the literal string 'infinity': Postgres's
  // timestamptz type accepts 'infinity' natively and sorts it after every
  // real timestamp, which is what turns "order by due_at asc, nulls last"
  // into a cursor comparison that does not need separate null-handling
  // logic from the one every other list's composite cursor already uses.
  dueAt: string;
  id: string;
}

// PRD.md §11.6 GET /tasks: everything assigned to this user and still open.
export async function findTaskQueueForAssignee(
  trx: Transaction<Database>,
  assigneeUserId: string,
  filter: TaskQueueFilter = {},
): Promise<TaskQueuePage> {
  let query = trx
    .selectFrom('case_tasks')
    .innerJoin('cases', 'cases.case_id', 'case_tasks.case_id')
    // users is not tenant-scoped (a person may belong to several
    // organisations), but the join is reached only through cases, which
    // RLS has already restricted to this tenant.
    .innerJoin('users as requester', 'requester.user_id', 'cases.submitted_by_user_id')
    .selectAll('case_tasks')
    .select(QUEUE_COLUMNS)
    .where('case_tasks.assignee_user_id', '=', assigneeUserId);

  query = filter.status
    ? query.where('case_tasks.status', '=', filter.status)
    : query.where('case_tasks.status', 'in', ['pending', 'claimed']);

  if (filter.definitionId) {
    query = query.where('cases.definition_id', '=', filter.definitionId);
  }
  if (filter.overdueAt) {
    query = query.where('case_tasks.due_at', '<', filter.overdueAt);
  }
  if (filter.query) {
    const term = `%${filter.query}%`;
    query = query.where((eb) =>
      eb.or([eb('cases.reference', 'ilike', term), eb('cases.title', 'ilike', term)]),
    );
  }

  const cursor = filter.cursor
    ? decodeCompositeCursor<QueueCursor>(filter.cursor, ['dueAt', 'id'])
    : null;
  if (cursor) {
    query = query.where(
      sql<boolean>`(COALESCE(case_tasks.due_at, 'infinity'::timestamptz), case_tasks.task_id) > (${cursor.dueAt}::timestamptz, ${cursor.id})`,
    );
  }

  const limit = clampPageSize(filter.limit);

  const rows = await query
    .orderBy(sql`COALESCE(case_tasks.due_at, 'infinity'::timestamptz)`, 'asc')
    .orderBy('case_tasks.task_id', 'asc')
    .limit(limit + 1)
    .execute();

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    entries: page.map(toQueueEntry),
    nextCursor:
      hasMore && last
        ? encodeCompositeCursor<QueueCursor>({
            dueAt: last.due_at ? last.due_at.toISOString() : 'infinity',
            id: last.task_id,
          })
        : null,
    hasMore,
  };
}

// Claimable pool: role- or group-assigned tasks nobody has claimed yet.
// PRD.md §7 models these with assignee_user_id null until someone claims.
export async function findClaimableTasks(
  trx: Transaction<Database>,
  roles: string[],
  groupIds: string[],
): Promise<CaseTask[]> {
  if (roles.length === 0 && groupIds.length === 0) {
    return [];
  }

  const rows = await trx
    .selectFrom('case_tasks')
    .selectAll()
    .where('status', '=', 'pending')
    .where('assignee_user_id', 'is', null)
    .where((eb) => {
      const clauses = [];
      if (roles.length > 0) {
        clauses.push(eb('assignee_role', 'in', roles));
      }
      if (groupIds.length > 0) {
        clauses.push(eb('assignee_group_id', 'in', groupIds));
      }
      return eb.or(clauses);
    })
    .orderBy('due_at', 'asc')
    .execute();

  return rows.map(toDomain);
}

// PRD.md §11.6 GET /tasks/available: the same pool, with the case columns a
// queue screen needs.
export async function findClaimableTaskQueue(
  trx: Transaction<Database>,
  roles: string[],
  groupIds: string[],
  filter: TaskQueueFilter = {},
): Promise<TaskQueuePage> {
  if (roles.length === 0 && groupIds.length === 0) {
    return { entries: [], nextCursor: null, hasMore: false };
  }

  let query = trx
    .selectFrom('case_tasks')
    .innerJoin('cases', 'cases.case_id', 'case_tasks.case_id')
    // users is not tenant-scoped (a person may belong to several
    // organisations), but the join is reached only through cases, which
    // RLS has already restricted to this tenant.
    .innerJoin('users as requester', 'requester.user_id', 'cases.submitted_by_user_id')
    .selectAll('case_tasks')
    .select(QUEUE_COLUMNS)
    .where('case_tasks.status', '=', 'pending')
    .where('case_tasks.assignee_user_id', 'is', null)
    .where((eb) => {
      const clauses = [];
      if (roles.length > 0) {
        clauses.push(eb('case_tasks.assignee_role', 'in', roles));
      }
      if (groupIds.length > 0) {
        clauses.push(eb('case_tasks.assignee_group_id', 'in', groupIds));
      }
      return eb.or(clauses);
    });

  if (filter.definitionId) {
    query = query.where('cases.definition_id', '=', filter.definitionId);
  }
  if (filter.overdueAt) {
    query = query.where('case_tasks.due_at', '<', filter.overdueAt);
  }
  if (filter.query) {
    const term = `%${filter.query}%`;
    query = query.where((eb) =>
      eb.or([eb('cases.reference', 'ilike', term), eb('cases.title', 'ilike', term)]),
    );
  }

  const cursor = filter.cursor
    ? decodeCompositeCursor<QueueCursor>(filter.cursor, ['dueAt', 'id'])
    : null;
  if (cursor) {
    query = query.where(
      sql<boolean>`(COALESCE(case_tasks.due_at, 'infinity'::timestamptz), case_tasks.task_id) > (${cursor.dueAt}::timestamptz, ${cursor.id})`,
    );
  }

  const limit = clampPageSize(filter.limit);

  const rows = await query
    .orderBy(sql`COALESCE(case_tasks.due_at, 'infinity'::timestamptz)`, 'asc')
    .orderBy('case_tasks.task_id', 'asc')
    .limit(limit + 1)
    .execute();

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    entries: page.map(toQueueEntry),
    nextCursor:
      hasMore && last
        ? encodeCompositeCursor<QueueCursor>({
            dueAt: last.due_at ? last.due_at.toISOString() : 'infinity',
            id: last.task_id,
          })
        : null,
    hasMore,
  };
}

// Has this user ever held this case's work? PRD.md §12.3 makes a past
// assignee a permitted viewer, so a rejected approver can still see what
// they acted on after the case moves on.
export async function hasUserHeldTaskOnCase(
  trx: Transaction<Database>,
  caseId: string,
  userId: string,
): Promise<boolean> {
  const row = await trx
    .selectFrom('case_tasks')
    .select('task_id')
    .where('case_id', '=', caseId)
    .where((eb) =>
      eb.or([
        eb('assignee_user_id', '=', userId),
        eb('claimed_by_user_id', '=', userId),
        eb('completed_by_user_id', '=', userId),
      ]),
    )
    .executeTakeFirst();

  return row !== undefined;
}

export class TaskConcurrencyError extends Error {
  constructor(public readonly taskId: string) {
    super(`Task ${taskId} was modified by another request.`);
    this.name = 'TaskConcurrencyError';
  }
}

// PRD.md §11.9: two approvers acting on the same task simultaneously must
// not both succeed. Same optimistic-concurrency shape as updateCaseState.
export async function claimCaseTask(
  trx: Transaction<Database>,
  taskId: string,
  expectedRowVersion: number,
  claimedByUserId: string,
): Promise<CaseTask> {
  const row = await trx
    .updateTable('case_tasks')
    .set({
      status: 'claimed',
      assignee_user_id: claimedByUserId,
      claimed_by_user_id: claimedByUserId,
      claimed_at: new Date(),
      row_version: expectedRowVersion + 1,
      updated_at: new Date(),
    })
    .where('task_id', '=', taskId)
    .where('row_version', '=', expectedRowVersion)
    .returningAll()
    .executeTakeFirst();

  if (!row) {
    throw new TaskConcurrencyError(taskId);
  }

  return toDomain(row);
}

export interface RecordTaskDecisionInput {
  taskId: string;
  expectedRowVersion: number;
  decision: TaskDecision;
  comment?: string | null;
  completedByUserId: string;
}

export async function recordTaskDecision(
  trx: Transaction<Database>,
  input: RecordTaskDecisionInput,
): Promise<CaseTask> {
  const row = await trx
    .updateTable('case_tasks')
    .set({
      status: 'completed',
      decision: input.decision,
      comment: input.comment ?? null,
      completed_by_user_id: input.completedByUserId,
      completed_at: new Date(),
      row_version: input.expectedRowVersion + 1,
      updated_at: new Date(),
    })
    .where('task_id', '=', input.taskId)
    .where('row_version', '=', input.expectedRowVersion)
    .returningAll()
    .executeTakeFirst();

  if (!row) {
    throw new TaskConcurrencyError(input.taskId);
  }

  return toDomain(row);
}

// Used when a case reaches a terminal step: PRD.md §6.3 step 4 cancels all
// outstanding tasks. Deliberately not version-checked, since it is a
// consequence of a transition that has already been authorised.
export async function cancelOpenTasksForCase(
  trx: Transaction<Database>,
  caseId: string,
): Promise<void> {
  await trx
    .updateTable('case_tasks')
    .set({ status: 'cancelled', updated_at: new Date() })
    .where('case_id', '=', caseId)
    .where('status', 'in', ['pending', 'claimed'])
    .execute();
}
