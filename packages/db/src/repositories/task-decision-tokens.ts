import type { Kysely, Selectable, Transaction } from 'kysely';

import type { Database, TaskDecisionTokensTable } from '../schema.js';
import { generateId } from '../uuid.js';

// No decision column: 'approve' is the only decision a one-click link ever
// grants (docs/decisions.md), so a row's mere existence already says what
// it is for. Adding a decision column ahead of a second decision actually
// existing would be exactly the premature generality CLAUDE.md's scope
// discipline rules out.
export interface TaskDecisionToken {
  tokenId: string;
  organisationId: string;
  taskId: string;
  recipientUserId: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

function toDomain(row: Selectable<TaskDecisionTokensTable>): TaskDecisionToken {
  return {
    tokenId: row.token_id,
    organisationId: row.organisation_id,
    taskId: row.task_id,
    recipientUserId: row.recipient_user_id,
    expiresAt: row.expires_at.toISOString(),
    usedAt: row.used_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export interface CreateTaskDecisionTokenInput {
  organisationId: string;
  taskId: string;
  recipientUserId: string;
  tokenHash: string;
  expiresAt: Date;
}

// Minted only from within the taskAssigned delivery path
// (handle-task-created.ts), once, per recipient, per task: tenant-scoped
// like every other write here.
export async function createTaskDecisionToken(
  trx: Transaction<Database>,
  input: CreateTaskDecisionTokenInput,
): Promise<TaskDecisionToken> {
  const row = await trx
    .insertInto('task_decision_tokens')
    .values({
      token_id: generateId(),
      organisation_id: input.organisationId,
      task_id: input.taskId,
      recipient_user_id: input.recipientUserId,
      token_hash: input.tokenHash,
      expires_at: input.expiresAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toDomain(row);
}

// Deliberate exception in the shape of ADR-0011's two: resolving a token
// into a task decision is inherently cross-tenant, and happens before the
// caller has any organisation context to scope a transaction by (that is
// exactly what this lookup exists to establish). Runs on the plain,
// unscoped connection, never withTenantTransaction. Narrow by construction:
// takes only a token hash, never an organisationId, and is not exported
// from the package barrel for anything but the tasks route to call.
export async function findTaskDecisionTokenByHash(
  db: Kysely<Database>,
  tokenHash: string,
): Promise<TaskDecisionToken | null> {
  const row = await db
    .selectFrom('task_decision_tokens')
    .selectAll()
    .where('token_hash', '=', tokenHash)
    .executeTakeFirst();

  return row ? toDomain(row) : null;
}

// Atomic single-use claim: the WHERE clause is what actually enforces
// "once," not application logic checking usedAt first and updating second,
// which would race under concurrent confirms of the same link. Also
// unscoped, for the same reason the lookup above is: the caller has not
// yet established an organisation context when this runs.
export async function markTaskDecisionTokenUsed(
  db: Kysely<Database>,
  tokenHash: string,
): Promise<TaskDecisionToken | null> {
  const row = await db
    .updateTable('task_decision_tokens')
    .set({ used_at: new Date() })
    .where('token_hash', '=', tokenHash)
    .where('used_at', 'is', null)
    .where('expires_at', '>', new Date())
    .returningAll()
    .executeTakeFirst();

  return row ? toDomain(row) : null;
}
