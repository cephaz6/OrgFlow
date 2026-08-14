import type {
  ProcessDefinition,
  ProcessDefinitionStatus,
  ProcessVersion,
  ProcessVersionStatus,
} from '@orgflow/types';
import { sql, type Selectable, type Transaction } from 'kysely';

import type { Database, ProcessDefinitionsTable, ProcessVersionsTable } from '../schema.js';
import { generateId } from '../uuid.js';

function toDefinitionDomain(row: Selectable<ProcessDefinitionsTable>): ProcessDefinition {
  return {
    definitionId: row.definition_id,
    organisationId: row.organisation_id,
    key: row.key,
    name: row.name,
    description: row.description,
    category: row.category,
    icon: row.icon,
    status: row.status as ProcessDefinitionStatus,
    currentVersionId: row.current_version_id,
    referencePrefix: row.reference_prefix,
    // BIGINT arrives as a string from node-postgres; the counter is a
    // per-definition case count, far below Number.MAX_SAFE_INTEGER.
    referenceCounter: Number(row.reference_counter),
    retentionDays: row.retention_days,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toVersionDomain(row: Selectable<ProcessVersionsTable>): ProcessVersion {
  return {
    versionId: row.version_id,
    organisationId: row.organisation_id,
    definitionId: row.definition_id,
    versionNumber: row.version_number,
    documentId: row.document_id,
    documentHash: row.document_hash,
    status: row.status as ProcessVersionStatus,
    changeNote: row.change_note,
    publishedByUserId: row.published_by_user_id,
    publishedAt: row.published_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export interface CreateProcessDefinitionInput {
  organisationId: string;
  key: string;
  name: string;
  description?: string | null;
  category?: string | null;
  icon?: string | null;
  referencePrefix: string;
  retentionDays?: number | null;
  createdByUserId: string;
}

export async function createProcessDefinition(
  trx: Transaction<Database>,
  input: CreateProcessDefinitionInput,
): Promise<ProcessDefinition> {
  const row = await trx
    .insertInto('process_definitions')
    .values({
      definition_id: generateId(),
      organisation_id: input.organisationId,
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? null,
      icon: input.icon ?? null,
      reference_prefix: input.referencePrefix,
      retention_days: input.retentionDays ?? null,
      created_by_user_id: input.createdByUserId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toDefinitionDomain(row);
}

export async function findProcessDefinitionByKey(
  trx: Transaction<Database>,
  key: string,
): Promise<ProcessDefinition | null> {
  const row = await trx
    .selectFrom('process_definitions')
    .selectAll()
    .where('key', '=', key)
    .executeTakeFirst();

  return row ? toDefinitionDomain(row) : null;
}

export async function findProcessDefinitionById(
  trx: Transaction<Database>,
  definitionId: string,
): Promise<ProcessDefinition | null> {
  const row = await trx
    .selectFrom('process_definitions')
    .selectAll()
    .where('definition_id', '=', definitionId)
    .executeTakeFirst();

  return row ? toDefinitionDomain(row) : null;
}

export async function findPublishedProcessDefinitions(
  trx: Transaction<Database>,
): Promise<ProcessDefinition[]> {
  const rows = await trx
    .selectFrom('process_definitions')
    .selectAll()
    .where('status', '=', 'published')
    .orderBy('name', 'asc')
    .execute();

  return rows.map(toDefinitionDomain);
}

export interface CreateProcessVersionInput {
  organisationId: string;
  definitionId: string;
  versionNumber: number;
  documentId: string;
  documentHash: string;
  changeNote?: string | null;
  publishedByUserId?: string | null;
}

export async function createProcessVersion(
  trx: Transaction<Database>,
  input: CreateProcessVersionInput,
): Promise<ProcessVersion> {
  const row = await trx
    .insertInto('process_versions')
    .values({
      version_id: generateId(),
      organisation_id: input.organisationId,
      definition_id: input.definitionId,
      version_number: input.versionNumber,
      document_id: input.documentId,
      document_hash: input.documentHash,
      change_note: input.changeNote ?? null,
      published_by_user_id: input.publishedByUserId ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toVersionDomain(row);
}

export async function findProcessVersionById(
  trx: Transaction<Database>,
  versionId: string,
): Promise<ProcessVersion | null> {
  const row = await trx
    .selectFrom('process_versions')
    .selectAll()
    .where('version_id', '=', versionId)
    .executeTakeFirst();

  return row ? toVersionDomain(row) : null;
}

// Marks a version published and points the definition at it. Both rows
// change together, so this takes the caller's transaction rather than
// opening its own.
export async function publishProcessVersion(
  trx: Transaction<Database>,
  versionId: string,
  publishedByUserId: string,
): Promise<ProcessVersion> {
  const version = await trx
    .updateTable('process_versions')
    .set({ status: 'published', published_by_user_id: publishedByUserId, published_at: new Date() })
    .where('version_id', '=', versionId)
    .returningAll()
    .executeTakeFirstOrThrow();

  await trx
    .updateTable('process_definitions')
    .set({ status: 'published', current_version_id: versionId, updated_at: new Date() })
    .where('definition_id', '=', version.definition_id)
    .execute();

  return toVersionDomain(version);
}

// ADR-0013: allocates the next case reference for a definition, e.g.
// LAP-000123.
//
// The increment and the read are a single UPDATE ... RETURNING, so Postgres
// holds a row lock for the duration and two concurrent submissions cannot
// receive the same number. Doing it as SELECT-then-UPDATE would be a
// textbook race. Because it runs inside the caller's submit transaction, a
// rolled-back submission leaves a gap in the sequence rather than reusing
// the number; gaps are the correct trade, since a reference that once
// identified an attempted submission should never later identify a
// different case.
export async function allocateCaseReference(
  trx: Transaction<Database>,
  definitionId: string,
): Promise<string> {
  const row = await trx
    .updateTable('process_definitions')
    // Raw SQL rather than the expression builder: reference_counter is a
    // BIGINT, which Kysely types as a string (node-postgres returns it as
    // one), so a numeric literal will not typecheck against it.
    .set({ reference_counter: sql<string>`reference_counter + 1` })
    .where('definition_id', '=', definitionId)
    .returning(['reference_prefix', 'reference_counter'])
    .executeTakeFirstOrThrow();

  return `${row.reference_prefix}-${String(row.reference_counter).padStart(6, '0')}`;
}
