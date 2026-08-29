import type { CaseComment, CommentVisibility } from '@orgflow/types';
import type { Selectable, Transaction } from 'kysely';

import type { CaseCommentsTable, Database } from '../schema.js';
import { generateId } from '../uuid.js';

function toDomain(row: Selectable<CaseCommentsTable>): CaseComment {
  return {
    commentId: row.comment_id,
    organisationId: row.organisation_id,
    caseId: row.case_id,
    authorUserId: row.author_user_id,
    body: row.body,
    visibility: row.visibility as CommentVisibility,
    createdAt: row.created_at.toISOString(),
  };
}

export interface CreateCaseCommentInput {
  organisationId: string;
  caseId: string;
  authorUserId: string;
  body: string;
  visibility: CommentVisibility;
}

export async function createCaseComment(
  trx: Transaction<Database>,
  input: CreateCaseCommentInput,
): Promise<CaseComment> {
  const row = await trx
    .insertInto('case_comments')
    .values({
      comment_id: generateId(),
      organisation_id: input.organisationId,
      case_id: input.caseId,
      author_user_id: input.authorUserId,
      body: input.body,
      visibility: input.visibility,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toDomain(row);
}

export interface FindCaseCommentsOptions {
  // Excludes 'approvers'-visibility comments when false: the route decides
  // this from canSeeInternalComments (apps/api/src/cases/permissions.ts),
  // not the caller of this function directly, so the filter lives here
  // rather than being left to every call site to remember.
  includeApproversOnly: boolean;
}

export async function findCommentsForCase(
  trx: Transaction<Database>,
  caseId: string,
  options: FindCaseCommentsOptions,
): Promise<CaseComment[]> {
  let query = trx.selectFrom('case_comments').selectAll().where('case_id', '=', caseId);

  if (!options.includeApproversOnly) {
    query = query.where('visibility', '=', 'all');
  }

  const rows = await query.orderBy('created_at', 'asc').execute();

  return rows.map(toDomain);
}
