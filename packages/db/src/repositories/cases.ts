import type { Case, CaseOutcome, CaseStatus } from '@orgflow/types';
import type { Selectable, Transaction } from 'kysely';

import { clampPageSize } from '../pagination.js';
import type { CasesTable, Database } from '../schema.js';
import { generateId } from '../uuid.js';

function toDomain(row: Selectable<CasesTable>): Case {
  return {
    caseId: row.case_id,
    organisationId: row.organisation_id,
    definitionId: row.definition_id,
    versionId: row.version_id,
    reference: row.reference,
    title: row.title,
    status: row.status as CaseStatus,
    outcome: row.outcome as CaseOutcome | null,
    currentStepKey: row.current_step_key,
    valuesDocumentId: row.values_document_id,
    submittedByUserId: row.submitted_by_user_id,
    submittedAt: row.submitted_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    dueAt: row.due_at?.toISOString() ?? null,
    rowVersion: row.row_version,
    redactedAt: row.redacted_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface CreateCaseInput {
  organisationId: string;
  definitionId: string;
  versionId: string;
  title: string;
  submittedByUserId: string;
  valuesDocumentId?: string | null;
}

// ADR-0013 allocates the real reference at submit, so a draft has none, but
// cases.reference is NOT NULL with UNIQUE (organisation_id, reference).
// A draft therefore carries a placeholder built from its own primary key:
// unique by construction, obviously not a real reference to anyone reading
// a row, and replaced by the allocated LAP-000123 in the submit
// transaction. Burning a counter value on a draft that may be abandoned is
// exactly what ADR-0013 rejected.
function draftReference(caseId: string): string {
  return `DRAFT-${caseId}`;
}

export function isDraftReference(reference: string): boolean {
  return reference.startsWith('DRAFT-');
}

export async function createCase(
  trx: Transaction<Database>,
  input: CreateCaseInput,
): Promise<Case> {
  const caseId = generateId();

  const row = await trx
    .insertInto('cases')
    .values({
      case_id: caseId,
      organisation_id: input.organisationId,
      definition_id: input.definitionId,
      version_id: input.versionId,
      reference: draftReference(caseId),
      title: input.title,
      submitted_by_user_id: input.submittedByUserId,
      values_document_id: input.valuesDocumentId ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toDomain(row);
}

export async function findCaseById(
  trx: Transaction<Database>,
  caseId: string,
): Promise<Case | null> {
  const row = await trx
    .selectFrom('cases')
    .selectAll()
    .where('case_id', '=', caseId)
    .executeTakeFirst();

  return row ? toDomain(row) : null;
}

export interface FindCasesFilter {
  submittedByUserId?: string;
  status?: CaseStatus;
  definitionId?: string;
  // PRD.md §11.10: cursor-based pagination. The cursor is the case_id of
  // the last row of the previous page. Ordering is by case_id descending
  // rather than created_at, which is what makes a single opaque cursor
  // sufficient: ADR-0003's UUID v7 keys are time-sortable, so id order and
  // creation order are the same order, with no ties to break.
  limit?: number;
  cursor?: string;
}

export interface CasePage {
  cases: Case[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function findCasesForCurrentTenant(
  trx: Transaction<Database>,
  filter: FindCasesFilter = {},
): Promise<CasePage> {
  const limit = clampPageSize(filter.limit);

  let query = trx.selectFrom('cases').selectAll();

  if (filter.submittedByUserId) {
    query = query.where('submitted_by_user_id', '=', filter.submittedByUserId);
  }
  if (filter.status) {
    query = query.where('status', '=', filter.status);
  }
  if (filter.definitionId) {
    query = query.where('definition_id', '=', filter.definitionId);
  }
  if (filter.cursor) {
    query = query.where('case_id', '<', filter.cursor);
  }

  // One row beyond the page, so hasMore is answered without a second count
  // query that could disagree with this one under concurrent inserts.
  const rows = await query
    .orderBy('case_id', 'desc')
    .limit(limit + 1)
    .execute();

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    cases: page.map(toDomain),
    nextCursor: hasMore ? (page[page.length - 1]?.case_id ?? null) : null,
    hasMore,
  };
}

export interface UpdateCaseStateInput {
  caseId: string;
  expectedRowVersion: number;
  status?: CaseStatus;
  outcome?: CaseOutcome | null;
  currentStepKey?: string | null;
  valuesDocumentId?: string | null;
  title?: string;
  // Both are set exactly once, in the submit transaction: the reference
  // when allocateCaseReference issues it, and the version when PRD.md §8.2
  // pins it. Neither may change afterwards, which the submit path enforces
  // by only ever passing them for a case in draft.
  reference?: string;
  versionId?: string;
  submittedAt?: Date | null;
  completedAt?: Date | null;
  dueAt?: Date | null;
}

export class CaseConcurrencyError extends Error {
  constructor(public readonly caseId: string) {
    super(`Case ${caseId} was modified by another request.`);
    this.name = 'CaseConcurrencyError';
  }
}

// PRD.md §11.9: cases carry a version column; updates assert the expected
// version and fail with a conflict if it has moved. Two approvers acting on
// the same case simultaneously must not both succeed, so the WHERE clause
// carries the version and a zero-row result is the conflict signal.
export async function updateCaseState(
  trx: Transaction<Database>,
  input: UpdateCaseStateInput,
): Promise<Case> {
  const row = await trx
    .updateTable('cases')
    .set({
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
      ...(input.currentStepKey !== undefined ? { current_step_key: input.currentStepKey } : {}),
      ...(input.valuesDocumentId !== undefined
        ? { values_document_id: input.valuesDocumentId }
        : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.reference !== undefined ? { reference: input.reference } : {}),
      ...(input.versionId !== undefined ? { version_id: input.versionId } : {}),
      ...(input.submittedAt !== undefined ? { submitted_at: input.submittedAt } : {}),
      ...(input.completedAt !== undefined ? { completed_at: input.completedAt } : {}),
      ...(input.dueAt !== undefined ? { due_at: input.dueAt } : {}),
      row_version: input.expectedRowVersion + 1,
      updated_at: new Date(),
    })
    .where('case_id', '=', input.caseId)
    .where('row_version', '=', input.expectedRowVersion)
    .returningAll()
    .executeTakeFirst();

  if (!row) {
    throw new CaseConcurrencyError(input.caseId);
  }

  return toDomain(row);
}
